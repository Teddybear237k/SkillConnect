require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const db         = require('./db/database');
const campay     = require('./campay');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'SkillConnect.html'));
});

const JWT_SECRET = process.env.JWT_SECRET || 'skillconnect_jwt_secret_2026_cameroun';

// ─── Token blacklist (logout) ─────────────────────────────────────────────────
const revokedTokens = new Set();

// ─── Middleware JWT ───────────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
  const auth  = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  if (revokedTokens.has(token)) return res.status(401).json({ error: 'Session expirée' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function validateFields(body, required) {
  for (const f of required) {
    if (!body[f] && body[f] !== 0) return `Champ requis : ${f}`;
  }
  return null;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  message: { error: 'Trop de requêtes.' },
  standardHeaders: true, legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('auth', (userId) => {
    userSockets[String(userId)] = socket.id;
    socket.userId = String(userId);
  });
  socket.on('disconnect', () => {
    if (socket.userId) delete userSockets[socket.userId];
  });
});

function emitToUser(userId, event, data) {
  const sid = userSockets[String(userId)];
  if (sid) io.to(sid).emit(event, data);
}

// ─── Africa's Talking SMS ─────────────────────────────────────────────────────
let atSMS = null;
try {
  if (process.env.AT_API_KEY && process.env.AT_API_KEY !== 'VOTRE_CLE_ICI') {
    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
    atSMS = at.SMS;
    console.log('✅ Africa\'s Talking SMS activé');
  } else {
    console.log('ℹ️  SMS désactivé (configurez AT_API_KEY dans .env)');
  }
} catch (e) {
  console.log('⚠️  Africa\'s Talking non disponible :', e.message);
}

async function sendSMS(phone, message) {
  if (!atSMS || !phone) return;
  try {
    const number    = String(phone).replace(/\s/g, '');
    const formatted = number.startsWith('+') ? number : '+237' + number;
    await atSMS.send({ to: [formatted], message, from: 'SkillConnect' });
    console.log('📱 SMS envoyé à', formatted);
  } catch (e) {
    console.error('SMS erreur :', e.message);
  }
}

// ─── Auth : Inscription ────────────────────────────────────────────────────────
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const err = validateFields(req.body, ['prenom', 'nom', 'skill']);
    if (err) return res.status(400).json({ error: err });

    if (req.body.email) {
      const existing = await db.findUserByEmail(req.body.email);
      if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }

    let password_hash = null;
    if (req.body.password) {
      if (req.body.password.length < 6)
        return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères).' });
      password_hash = await bcrypt.hash(req.body.password, 10);
    }

    const user  = await db.createUser({ ...req.body, password_hash });
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    if (user.phone) {
      sendSMS(user.phone, `Bienvenue sur SkillConnect, ${user.prenom} ! 🎉\nVotre profil "${user.skill}" est en ligne.`);
    }

    res.json({ success: true, user, token });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Auth : Connexion ─────────────────────────────────────────────────────────
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const err = validateFields(req.body, ['email', 'password']);
    if (err) return res.status(400).json({ error: err });

    const user = await db.findUserByEmail(req.body.email);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    if (!user.password_hash)
      return res.status(401).json({ error: 'Ce compte n\'a pas de mot de passe défini.' });

    const match = await bcrypt.compare(req.body.password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash: _ph, ...safeUser } = user;
    res.json({ success: true, user: safeUser, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Auth : Déconnexion ────────────────────────────────────────────────────────
app.post('/api/logout', authenticateToken, (req, res) => {
  revokedTokens.add(req.headers['authorization'].slice(7));
  res.json({ success: true });
});

// ─── Auth : Supprimer compte ───────────────────────────────────────────────────
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.user.userId !== targetId)
    return res.status(403).json({ error: 'Accès refusé.' });
  try {
    const ok = await db.deleteUser(targetId);
    if (!ok) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    revokedTokens.add(req.headers['authorization'].slice(7));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Talents ──────────────────────────────────────────────────────────────────
app.get('/api/talents', async (req, res) => {
  try { res.json(await db.getTalents(req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/talents/:id', async (req, res) => {
  try {
    const t = await db.getTalentById(parseInt(req.params.id));
    if (!t) return res.status(404).json({ error: 'Talent non trouvé' });
    const { password_hash: _ph, ...safe } = t;
    res.json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Tableau de bord ──────────────────────────────────────────────────────────
app.get('/api/dashboard/:userId', async (req, res) => {
  try {
    const data = await db.getDashboardData(parseInt(req.params.userId));
    if (!data) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/profile/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try {
    await db.updateUser(parseInt(req.params.userId), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Messagerie ───────────────────────────────────────────────────────────────
app.get('/api/contacts/:userId', async (req, res) => {
  try { res.json(await db.getContacts(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:userId/:contactId', async (req, res) => {
  try {
    res.json(await db.getMessages(parseInt(req.params.userId), parseInt(req.params.contactId)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;
    const err = validateFields(req.body, ['senderId', 'receiverId', 'text']);
    if (err) return res.status(400).json({ error: err });
    if (req.user.userId !== parseInt(senderId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const msg    = await db.sendMessage(parseInt(senderId), parseInt(receiverId), text);
    const sender = await db.getTalentById(parseInt(senderId));

    if (sender) {
      const notif = await db.createNotification({
        userId: parseInt(receiverId),
        type: 'message',
        message: `Nouveau message de ${sender.prenom} ${sender.nom}`,
      });
      emitToUser(receiverId, 'new_notification', notif);
    }

    emitToUser(receiverId, 'new_message', {
      ...msg,
      sender_initials: sender?.initials || '?',
      sender_bg:       sender?.bg_color || '#ccc',
      sender_col:      sender?.text_color || '#000',
      sender_prenom:   sender?.prenom || '',
      sender_photo:    sender?.photo || null,
    });

    const isBooking = text.toLowerCase().includes('réserver') || text.toLowerCase().includes('reserver');
    if (isBooking) {
      const receiver = await db.getTalentById(parseInt(receiverId));
      if (receiver?.phone) {
        sendSMS(receiver.phone,
          `SkillConnect : ${sender ? sender.prenom + ' ' + sender.nom : 'Un utilisateur'} souhaite réserver une session avec vous !`
        );
      }
    }

    res.json({ success: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/messages/read/:userId/:contactId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try {
    await db.markAsRead(parseInt(req.params.userId), parseInt(req.params.contactId));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Paiements ────────────────────────────────────────────────────────────────
app.post('/api/pay', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['senderId', 'receiverId', 'amount', 'description']);
    if (err) return res.status(400).json({ error: err });
    if (req.user.userId !== parseInt(req.body.senderId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const sender   = await db.getTalentById(parseInt(req.body.senderId));
    const receiver = await db.getTalentById(parseInt(req.body.receiverId));

    if (campay.isConfigured() && sender?.phone) {
      let campayResult;
      try {
        campayResult = await campay.collect({
          amount:      parseInt(req.body.amount),
          phone:       sender.phone,
          description: `Mission : ${req.body.description}`,
          externalRef: `sc-pay-${Date.now()}`,
        });
      } catch (campayErr) {
        return res.status(502).json({ error: 'Erreur Campay : ' + campayErr.message });
      }

      const tx  = await db.createTransaction({ ...req.body, campay_reference: campayResult.reference });
      const net = tx.amount - tx.commission;
      emitToUser(tx.receiver_id, 'new_notification', {
        type: 'payment',
        message: `Paiement de ${net.toLocaleString('fr-FR')} FCFA attendu pour "${tx.description}"`,
      });
      return res.json({
        success: true, transaction: tx,
        campay: {
          reference: campayResult.reference,
          ussd_code: campayResult.ussd_code,
          operator:  campayResult.operator,
          message:   `Confirmez ${tx.amount.toLocaleString('fr-FR')} FCFA sur votre téléphone (${campayResult.operator || req.body.network || 'MoMo'})`,
        },
      });
    }

    // Mode simulation
    const tx  = await db.createTransaction(req.body);
    const net = tx.amount - tx.commission;
    emitToUser(tx.receiver_id, 'new_notification', {
      type: 'payment',
      message: `Paiement de ${net.toLocaleString('fr-FR')} FCFA reçu pour "${tx.description}"`,
    });
    if (sender?.phone)   sendSMS(sender.phone,   `SkillConnect : Paiement de ${tx.amount.toLocaleString('fr-FR')} FCFA envoyé. Fonds en séquestre.`);
    if (receiver?.phone) sendSMS(receiver.phone,  `SkillConnect : Vous allez recevoir ${net.toLocaleString('fr-FR')} FCFA. Libéré après validation.`);

    res.json({ success: true, transaction: tx, simulated: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Valider une mission (séquestre → complété) ───────────────────────────────
app.put('/api/transactions/:id/validate', authenticateToken, async (req, res) => {
  try {
    const txList = await db.getTransactions(req.user.userId);
    const tx = txList.find(t => String(t.id) === String(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });
    if (tx.sender_id !== req.user.userId)
      return res.status(403).json({ error: 'Seul l\'envoyeur peut valider la mission.' });
    if (tx.status !== 'escrow')
      return res.status(400).json({ error: 'Cette transaction n\'est pas en séquestre.' });

    const updated  = await db.updateTransactionStatus(req.params.id, 'completed');
    const receiver = await db.getTalentById(tx.receiver_id);
    const net      = tx.amount - tx.commission;

    const notif = await db.createNotification({
      userId: tx.receiver_id,
      type: 'payment',
      message: `Mission validée ! ${net.toLocaleString('fr-FR')} FCFA ont été libérés sur votre compte.`,
    });
    emitToUser(tx.receiver_id, 'new_notification', notif);

    if (receiver?.phone) {
      sendSMS(receiver.phone, `SkillConnect : Mission validée ! ${net.toLocaleString('fr-FR')} FCFA crédités sur votre compte.`);
    }

    res.json({ success: true, transaction: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wallet/:userId', async (req, res) => {
  try { res.json(await db.getWallet(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transactions/:userId', async (req, res) => {
  try { res.json(await db.getTransactions(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/transactions/:id/status', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['status']);
    if (err) return res.status(400).json({ error: err });
    const tx = await db.updateTransactionStatus(req.params.id, req.body.status);
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Retrait ──────────────────────────────────────────────────────────────────
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['userId', 'amount', 'network', 'phone']);
    if (err) return res.status(400).json({ error: err });
    if (req.user.userId !== parseInt(req.body.userId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const amount = parseInt(req.body.amount);
    if (isNaN(amount) || amount < 500)
      return res.status(400).json({ error: 'Montant minimum : 500 FCFA.' });

    const tx = await db.createWithdrawal({
      userId: parseInt(req.body.userId),
      amount, network: req.body.network, phone: req.body.phone,
    });

    if (campay.isConfigured()) {
      try {
        const result = await campay.transfer({
          amount, phone: req.body.phone,
          description: `Retrait SkillConnect #${tx.id}`,
          externalRef: `sc-withdraw-${tx.id}`,
        });
        await db.updateTransactionStatus(tx.id, result.status === 'SUCCESSFUL' ? 'completed' : 'pending');
        tx.campay_reference = result.reference;
        tx.campay_status    = result.status;
      } catch (campayErr) {
        console.error('Campay transfer error:', campayErr.message);
      }
    } else {
      await db.updateTransactionStatus(tx.id, 'completed');
    }

    sendSMS(req.body.phone, `SkillConnect : Retrait de ${amount.toLocaleString('fr-FR')} FCFA via ${req.body.network} initié.`);
    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Dépôt ────────────────────────────────────────────────────────────────────
app.post('/api/deposit', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['userId', 'amount', 'network', 'phone']);
    if (err) return res.status(400).json({ error: err });
    if (req.user.userId !== parseInt(req.body.userId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const amount = parseInt(req.body.amount);
    if (isNaN(amount) || amount < 100)
      return res.status(400).json({ error: 'Montant minimum : 100 FCFA.' });

    if (campay.isConfigured()) {
      let campayResult;
      try {
        campayResult = await campay.collect({
          amount, phone: req.body.phone,
          description: 'Dépôt SkillConnect',
          externalRef: `sc-deposit-${Date.now()}`,
        });
      } catch (campayErr) {
        return res.status(502).json({ error: 'Erreur Campay : ' + campayErr.message });
      }

      const tx = await db.createDeposit({
        userId: parseInt(req.body.userId),
        amount, network: req.body.network, phone: req.body.phone,
        campay_reference: campayResult.reference,
      });

      return res.json({
        success: true, transaction: tx,
        campay: {
          reference: campayResult.reference,
          ussd_code: campayResult.ussd_code,
          operator:  campayResult.operator,
          message:   `Confirmez ${amount.toLocaleString('fr-FR')} FCFA sur votre téléphone (${campayResult.operator || req.body.network})`,
        },
      });
    }

    const tx = await db.createDeposit({
      userId: parseInt(req.body.userId),
      amount, network: req.body.network, phone: req.body.phone,
    });
    res.json({ success: true, transaction: tx, simulated: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Statut Campay (polling) ──────────────────────────────────────────────────
app.get('/api/transactions/:id/campay-status', authenticateToken, async (req, res) => {
  try {
    const txList = await db.getTransactions(req.user.userId);
    const tx = txList.find(t => String(t.id) === String(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });

    if (!tx.campay_reference || !campay.isConfigured())
      return res.json({ status: tx.status, campay_status: null });

    const result = await campay.checkTransaction(tx.campay_reference);
    if (!result) return res.json({ status: tx.status, campay_status: null });

    if (result.status === 'SUCCESSFUL' && tx.status !== 'completed') {
      await db.updateTransactionStatus(tx.id, 'completed');
      const notif = await db.createNotification({
        userId: req.user.userId,
        type: 'payment',
        message: `Dépôt de ${Number(result.amount).toLocaleString('fr-FR')} FCFA confirmé !`,
      });
      emitToUser(req.user.userId, 'new_notification', notif);
    } else if (result.status === 'FAILED' && tx.status === 'pending') {
      await db.updateTransactionStatus(tx.id, 'cancelled');
    }

    res.json({
      status: result.status === 'SUCCESSFUL' ? 'completed' : result.status.toLowerCase(),
      campay_status: result.status,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Webhook Campay ───────────────────────────────────────────────────────────
app.post('/api/campay/webhook', async (req, res) => {
  try {
    const { reference, status } = req.body;
    console.log(`🔔 Campay webhook : ref=${reference} status=${status}`);
    if (!reference || !status) return res.status(400).json({ error: 'Données manquantes' });

    const tx = await db.findTransactionByCampayRef(reference);
    if (tx) {
      if (status === 'SUCCESSFUL' && tx.status !== 'completed') {
        await db.updateTransactionStatus(tx.id, 'completed');
        const userId = tx.type === 'deposit' ? tx.receiver_id : tx.sender_id;
        const notif  = await db.createNotification({
          userId,
          type: 'payment',
          message: `Paiement de ${Number(tx.amount).toLocaleString('fr-FR')} FCFA confirmé via ${tx.network} !`,
        });
        emitToUser(userId, 'new_notification', notif);
        emitToUser(userId, 'payment_confirmed', { txId: tx.id, amount: tx.amount });
      } else if (status === 'FAILED') {
        await db.updateTransactionStatus(tx.id, 'cancelled');
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
app.get('/api/reviews/:talentId', async (req, res) => {
  try { res.json(await db.getReviews(parseInt(req.params.talentId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reviews', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['talentId', 'rating', 'comment']);
    if (err) return res.status(400).json({ error: err });
    if (req.body.rating < 1 || req.body.rating > 5)
      return res.status(400).json({ error: 'La note doit être entre 1 et 5.' });

    const review = await db.createReview({ ...req.body, authorId: req.user.userId });
    emitToUser(req.body.talentId, 'new_notification', {
      type: 'review',
      message: `Vous avez reçu un nouvel avis ${req.body.rating} étoile${req.body.rating > 1 ? 's' : ''} ⭐`,
    });
    res.json({ success: true, review });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications/:userId', async (req, res) => {
  try { res.json(await db.getNotifications(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try { await db.markNotificationRead(parseInt(req.params.id)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/read-all/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { await db.markAllNotificationsRead(parseInt(req.params.userId)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n🚀 SkillConnect démarré → http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error('❌ Erreur connexion MySQL :', err.message);
    console.error('Vérifiez DB_HOST, DB_USER, DB_PASSWORD, DB_NAME dans .env');
    process.exit(1);
  });
