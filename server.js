require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const path         = require('path');
const cors         = require('cors');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const rateLimit    = require('express-rate-limit');
const nodemailer   = require('nodemailer');
const crypto       = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const webPush      = require('web-push');
const db           = require('./db/database');
const monetbil     = require('./monetbil');

// VAPID push notifications
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  webPush.setVapidDetails(
    'mailto:' + (process.env.SMTP_USER || 'admin@skillconnect.cm'),
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
  );
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Fichiers statiques — HTML et SW jamais en cache, assets long cache
app.use(express.static(__dirname, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'SkillConnect.html'));
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET manquant dans .env'); process.exit(1); }

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

const messageLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { error: 'Trop de messages envoyés. Patientez une minute.' },
  standardHeaders: true, legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('auth', (token) => {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (revokedTokens.has(token)) return;
      const userId = String(payload.userId);
      userSockets[userId] = socket.id;
      socket.userId = userId;
      io.emit('user_online', { userId: parseInt(userId) });
    } catch {
      // Token invalide — socket non authentifié, aucun événement sensible ne sera émis
    }
  });
  socket.on('disconnect', () => {
    if (socket.userId) {
      db.updateLastSeen(parseInt(socket.userId)).catch(() => {});
      io.emit('user_offline', { userId: parseInt(socket.userId) });
      delete userSockets[socket.userId];
    }
  });
  socket.on('typing', ({ to }) => {
    const sid = userSockets[String(to)];
    if (sid) io.to(sid).emit('typing', { from: socket.userId });
  });
  socket.on('stop_typing', ({ to }) => {
    const sid = userSockets[String(to)];
    if (sid) io.to(sid).emit('stop_typing', { from: socket.userId });
  });
});

function emitToUser(userId, event, data) {
  const sid = userSockets[String(userId)];
  if (sid) io.to(sid).emit(event, data);
}

async function pushToUser(userId, title, body, url = '/') {
  try {
    if (!process.env.VAPID_PUBLIC) return;
    const subs = await db.getUserPushSubscriptions(userId);
    for (const s of subs) {
      try {
        await webPush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, icon: '/icon-192.svg', url })
        );
      } catch(e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await db.deletePushSubscription(userId, s.endpoint);
        }
      }
    }
  } catch(e) {}
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

    // Email de vérification
    if (user.email) {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      await db.createVerifyToken(user.id, verifyToken);
      const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/?verify_token=${verifyToken}`;
      if (mailer) {
        sendEmail(user.email, 'Vérifiez votre email — SkillConnect',
          `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#1D9E75">SkillConnect</h2><p>Bonjour ${user.prenom},</p><p>Bienvenue ! Cliquez sur le bouton ci-dessous pour vérifier votre adresse email.</p><a href="${verifyUrl}" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">Vérifier mon email</a><p style="color:#888;font-size:.85rem">Si vous n'avez pas créé de compte, ignorez cet email.</p></div>`
        );
      } else {
        console.log(`📧 Verify email URL pour ${user.email} : ${verifyUrl}`);
      }
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

    const ban = await db.getUserBan(user.id);
    if (ban) {
      const until = ban.ban_until ? ` jusqu'au ${new Date(ban.ban_until).toLocaleDateString('fr-FR')}` : ' définitivement';
      return res.status(403).json({ error: `Compte suspendu${until}. Motif : ${ban.reason||'Violation des CGU'}.`, banned: true });
    }

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
    // Enregistrer la vue (viewer_id depuis token optionnel)
    let viewerId = null;
    try {
      const auth = req.headers.authorization;
      if (auth) { const payload = require('jsonwebtoken').verify(auth.split(' ')[1], process.env.JWT_SECRET); viewerId = payload.userId; }
    } catch(e) {}
    db.recordProfileView(parseInt(req.params.id), viewerId).catch(()=>{});
    res.json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Tableau de bord ──────────────────────────────────────────────────────────
app.get('/api/dashboard/:userId', async (req, res) => {
  try {
    const uid = parseInt(req.params.userId);
    const data = await db.getDashboardData(uid);
    if (!data) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    data.monthlyStats = await db.getMonthlyStats(uid);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/profile/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try {
    const body = { ...req.body };

    // Changement de mot de passe (optionnel)
    if (body.new_password) {
      if (body.new_password !== body.confirm_password)
        return res.status(400).json({ error: 'Les mots de passe ne correspondent pas.' });
      if (body.new_password.length < 8)
        return res.status(400).json({ error: 'Mot de passe trop court (min 8 caractères).' });
      const user = await db.getTalentById(parseInt(req.params.userId));
      if (user?.password_hash) {
        const valid = await bcrypt.compare(body.current_password || '', user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
      }
      body.password_hash = await bcrypt.hash(body.new_password, 12);
    }
    delete body.new_password;
    delete body.confirm_password;
    delete body.current_password;

    await db.updateUser(parseInt(req.params.userId), body);
    const updated = await db.getTalentById(parseInt(req.params.userId));
    res.json({ success: true, user: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Messagerie ───────────────────────────────────────────────────────────────
app.get('/api/contacts/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { res.json(await db.getContacts(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:userId/:contactId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try {
    res.json(await db.getMessages(parseInt(req.params.userId), parseInt(req.params.contactId)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', authenticateToken, messageLimiter, async (req, res) => {
  try {
    const { senderId, receiverId, text, fileData, fileName, fileType } = req.body;
    const err = validateFields(req.body, ['senderId', 'receiverId']);
    if (err) return res.status(400).json({ error: err });
    if (!text && !fileData) return res.status(400).json({ error: 'Message ou fichier requis.' });
    if (req.user.userId !== parseInt(senderId))
      return res.status(403).json({ error: 'Accès refusé.' });
    if (fileData && fileData.length > 7_000_000)
      return res.status(413).json({ error: 'Fichier trop lourd (max 5 Mo).' });

    // Vérifier si le destinataire a bloqué l'expéditeur
    if (await db.isBlocked(parseInt(receiverId), parseInt(senderId)))
      return res.status(403).json({ error: 'Vous ne pouvez pas contacter cet utilisateur.' });

    const { replyToId } = req.body;
    const msg    = await db.sendMessage(parseInt(senderId), parseInt(receiverId), text || '', fileData || null, fileName || null, fileType || null, replyToId ? parseInt(replyToId) : null);
    const sender = await db.getTalentById(parseInt(senderId));

    if (sender) {
      const notif = await db.createNotification({
        userId: parseInt(receiverId),
        type: 'message',
        message: `Nouveau message de ${sender.prenom} ${sender.nom}`,
        relatedId: parseInt(senderId),
      });
      emitToUser(receiverId, 'new_notification', notif);
      // Push si l'utilisateur n'est pas connecté au socket
      pushToUser(
        receiverId,
        `${sender.prenom} ${sender.nom || ''}`.trim(),
        text ? text.slice(0, 100) : '📎 Fichier joint',
        `${process.env.APP_URL || ''}/?contact=${senderId}`
      );
    }

    emitToUser(receiverId, 'new_message', {
      ...msg,
      sender_initials: sender?.initials || '?',
      sender_bg:       sender?.bg_color || '#ccc',
      sender_col:      sender?.text_color || '#000',
      sender_prenom:   sender?.prenom || '',
      sender_photo:    sender?.photo || null,
    });

    // Email si le destinataire n'est pas connecté via socket
    if (!userSockets[String(receiverId)]) {
      const receiverUser = await db.getTalentById(parseInt(receiverId));
      if (receiverUser?.email) sendEmail(receiverUser.email,
        `Nouveau message de ${sender?.prenom||'un utilisateur'} — SkillConnect`,
        `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#1D9E75">SkillConnect</h2><p>Bonjour ${receiverUser.prenom},</p><p>Vous avez reçu un message de <strong>${sender?.prenom||''} ${sender?.nom||''}</strong> :</p><blockquote style="border-left:3px solid #1D9E75;padding:.5rem 1rem;color:#555;margin:1rem 0">${String(text).slice(0,200)}</blockquote><a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Répondre</a></div>`
      );
    }

    const isBooking = (text||'').toLowerCase().includes('réserver') || (text||'').toLowerCase().includes('reserver');
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
    emitToUser(parseInt(req.params.contactId), 'messages_read', { by: parseInt(req.params.userId) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Réactions sur un message
app.post('/api/messages/:id/react', authenticateToken, async (req, res) => {
  try {
    const { emoji, contactId } = req.body;
    if (!emoji) return res.status(400).json({ error: 'emoji requis' });
    const result = await db.toggleReaction(parseInt(req.params.id), req.user.userId, emoji);
    const payload = { messageId: parseInt(req.params.id), ...result, userId: req.user.userId };
    emitToUser(req.user.userId, 'reaction_update', payload);
    if (contactId) emitToUser(parseInt(contactId), 'reaction_update', payload);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/last-seen', authenticateToken, async (req, res) => {
  try {
    const user = await db.getTalentById(parseInt(req.params.id));
    res.json({ last_seen: user?.last_seen || null, online: !!userSockets[String(req.params.id)] });
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

    if (monetbil.isConfigured() && sender?.phone) {
      let mbResult;
      try {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        mbResult = await monetbil.initPayment({
          amount:    parseInt(req.body.amount),
          phone:     sender.phone,
          firstName: sender.prenom,
          lastName:  sender.nom,
          email:     sender.email || '',
          itemRef:   `sc-pay-${Date.now()}`,
          notifyUrl: `${appUrl}/api/monetbil/webhook`,
          returnUrl: appUrl,
        });
      } catch (mbErr) {
        return res.status(502).json({ error: 'Erreur Monetbil : ' + mbErr.message });
      }

      const tx  = await db.createTransaction({ ...req.body, campay_reference: mbResult.transaction_id });
      const net = tx.amount - tx.commission;
      emitToUser(tx.receiver_id, 'new_notification', {
        type: 'payment',
        message: `Paiement de ${net.toLocaleString('fr-FR')} FCFA attendu pour "${tx.description}"`,
      });
      if (receiver?.email) sendEmail(
        receiver.email,
        `Nouvelle réservation — SkillConnect`,
        `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;border-radius:12px;border:1px solid #e5e7eb">
          <h2 style="color:#1D9E75;margin-top:0">SkillConnect</h2>
          <p>Bonjour <strong>${receiver.prenom}</strong>,</p>
          <p><strong>${sender?.prenom||'Un client'} ${sender?.nom||''}</strong> vient de réserver vos services :</p>
          <div style="background:#f0fdf4;border-left:4px solid #1D9E75;border-radius:6px;padding:14px 16px;margin:16px 0">
            <p style="margin:0;font-size:1rem"><strong>${tx.description}</strong></p>
            <p style="margin:6px 0 0;color:#1D9E75;font-size:1.1rem;font-weight:700">${net.toLocaleString('fr-FR')} FCFA</p>
          </div>
          <p style="color:#6b7280;font-size:.9rem">Le paiement est en cours de traitement via Mobile Money. Vous recevrez une confirmation dès qu'il sera validé.</p>
          <a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">Voir sur SkillConnect</a>
          <p style="color:#9ca3af;font-size:.8rem;margin-top:24px">SkillConnect — La plateforme des talents camerounais</p>
        </div>`
      );
      return res.json({
        success: true, transaction: tx,
        monetbil: {
          transaction_id: mbResult.transaction_id,
          payment_url:    mbResult.payment_url,
          message: `Cliquez sur le lien pour payer ${tx.amount.toLocaleString('fr-FR')} FCFA via Mobile Money.`,
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
    if (receiver?.email) sendEmail(receiver.email,
      `Nouveau paiement reçu — SkillConnect`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#1D9E75">SkillConnect</h2><p>Bonjour ${receiver.prenom},</p><p><strong>${sender?.prenom||'Un client'}</strong> vous a envoyé <strong>${net.toLocaleString('fr-FR')} FCFA</strong> pour &quot;${tx.description}&quot;.</p><p>Ces fonds sont en <strong>séquestre sécurisé</strong> et seront libérés une fois la mission validée.</p><a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:1rem">Voir sur SkillConnect</a></div>`
    );

    res.json({ success: true, transaction: tx, simulated: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Valider une mission (séquestre → complété) ───────────────────────────────
app.put('/api/transactions/:id/validate', authenticateToken, async (req, res) => {
  try {
    const txList = await db.getTransactions(req.user.userId);
    const tx = txList.find(t => String(t.id) === String(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });
    if (parseInt(tx.sender_id) !== req.user.userId)
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
      relatedId: tx.id,
    });
    emitToUser(tx.receiver_id, 'new_notification', notif);

    if (receiver?.phone) {
      sendSMS(receiver.phone, `SkillConnect : Mission validée ! ${net.toLocaleString('fr-FR')} FCFA crédités sur votre compte.`);
    }
    if (receiver?.email) sendEmail(receiver.email,
      `Mission validée — ${net.toLocaleString('fr-FR')} FCFA libérés`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#1D9E75">SkillConnect</h2><p>Bonjour ${receiver.prenom},</p><p>Votre mission &quot;${tx.description}&quot; a été validée par le client. <strong>${net.toLocaleString('fr-FR')} FCFA</strong> ont été libérés sur votre compte SkillConnect.</p></div>`
    );

    res.json({ success: true, transaction: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wallet/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { res.json(await db.getWallet(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transactions/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { res.json(await db.getTransactions(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/transactions/:id/status', authenticateToken, async (req, res) => {
  const ALLOWED_STATUSES = ['escrow', 'delivered', 'completed', 'cancelled'];
  try {
    const err = validateFields(req.body, ['status']);
    if (err) return res.status(400).json({ error: err });
    if (!ALLOWED_STATUSES.includes(req.body.status))
      return res.status(400).json({ error: 'Statut invalide.' });
    // Vérifier que l'appelant est partie prenante de la transaction
    const txList = await db.getTransactions(req.user.userId);
    const own = txList.find(t => String(t.id) === String(req.params.id));
    if (!own) return res.status(403).json({ error: 'Accès refusé.' });
    // Seul l'envoyeur (client) peut marquer comme 'completed'
    if (req.body.status === 'completed' && parseInt(own.sender_id) !== req.user.userId)
      return res.status(403).json({ error: 'Seul le client peut valider la mission.' });
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

    // Monetbil ne supporte pas les paiements sortants — traitement manuel par l'admin
    await db.updateTransactionStatus(tx.id, 'pending');

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

    if (monetbil.isConfigured()) {
      let mbResult;
      try {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        mbResult = await monetbil.initPayment({
          amount, phone: req.body.phone,
          itemRef:   `sc-deposit-${Date.now()}`,
          notifyUrl: `${appUrl}/api/monetbil/webhook`,
          returnUrl: appUrl,
        });
      } catch (mbErr) {
        return res.status(502).json({ error: 'Erreur Monetbil : ' + mbErr.message });
      }

      const tx = await db.createDeposit({
        userId: parseInt(req.body.userId),
        amount, network: req.body.network, phone: req.body.phone,
        campay_reference: mbResult.transaction_id,
      });

      return res.json({
        success: true, transaction: tx,
        monetbil: {
          transaction_id: mbResult.transaction_id,
          payment_url:    mbResult.payment_url,
          message: `Cliquez sur le lien pour déposer ${amount.toLocaleString('fr-FR')} FCFA via Mobile Money.`,
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

// ─── Statut Monetbil (polling fallback) ───────────────────────────────────────
app.get('/api/transactions/:id/payment-status', authenticateToken, async (req, res) => {
  try {
    const txList = await db.getTransactions(req.user.userId);
    const tx = txList.find(t => String(t.id) === String(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });

    if (!tx.campay_reference || !monetbil.isConfigured())
      return res.json({ status: tx.status });

    const result = await monetbil.checkPayment(tx.campay_reference);
    if (!result) return res.json({ status: tx.status });

    // status Monetbil : 1 = succès, 2 = en attente, 3 = échec
    if ((result.status === 1 || result.status === '1') && tx.status !== 'completed') {
      await db.updateTransactionStatus(tx.id, 'completed');
      const notif = await db.createNotification({
        userId: req.user.userId,
        type: 'payment',
        message: `Dépôt de ${Number(result.amount || tx.amount).toLocaleString('fr-FR')} FCFA confirmé !`,
        relatedId: tx.id,
      });
      emitToUser(req.user.userId, 'new_notification', notif);
    } else if ((result.status === 3 || result.status === '3') && tx.status === 'pending') {
      await db.updateTransactionStatus(tx.id, 'cancelled');
    }

    const statusMap = { '1': 'completed', '2': 'pending', '3': 'cancelled' };
    res.json({ status: statusMap[String(result.status)] || tx.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Webhook Monetbil ─────────────────────────────────────────────────────────
app.post('/api/monetbil/webhook', async (req, res) => {
  try {
    const { transaction_id, status, payment_ref, amount } = req.body;
    console.log(`🔔 Monetbil webhook : txId=${transaction_id} status=${status}`);

    if (!monetbil.verifyWebhook(req.body)) {
      console.warn('Monetbil webhook signature invalide');
      return res.status(400).json({ error: 'Signature invalide' });
    }

    const tx = await db.findTransactionByCampayRef(transaction_id || payment_ref);
    if (tx) {
      const success = status === 1 || status === '1' || status === 'success';
      const failed  = status === 3 || status === '3' || status === 'failed';

      if (success && tx.status !== 'completed') {
        await db.updateTransactionStatus(tx.id, 'completed');
        const userId   = tx.type === 'deposit' ? tx.receiver_id : tx.sender_id;
        const notif    = await db.createNotification({
          userId,
          type: 'payment',
          message: `Paiement de ${Number(amount || tx.amount).toLocaleString('fr-FR')} FCFA confirmé via Mobile Money !`,
          relatedId: tx.id,
        });
        emitToUser(userId, 'new_notification', notif);
        emitToUser(userId, 'payment_confirmed', { txId: tx.id, amount: tx.amount });
        const talent = await db.getTalentById(tx.receiver_id);
        const client = await db.getTalentById(tx.sender_id);
        const net    = Number(tx.amount) - Number(tx.commission || 0);
        if (talent?.email) sendEmail(
          talent.email,
          `Paiement confirmé — SkillConnect`,
          `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;border-radius:12px;border:1px solid #e5e7eb">
            <h2 style="color:#1D9E75;margin-top:0">SkillConnect</h2>
            <p>Bonjour <strong>${talent.prenom}</strong>,</p>
            <p>Le paiement de <strong>${client?.prenom||'votre client'} ${client?.nom||''}</strong> a été confirmé ✅</p>
            <div style="background:#f0fdf4;border-left:4px solid #1D9E75;border-radius:6px;padding:14px 16px;margin:16px 0">
              <p style="margin:0;font-size:1rem"><strong>${tx.description}</strong></p>
              <p style="margin:6px 0 0;color:#1D9E75;font-size:1.1rem;font-weight:700">${net.toLocaleString('fr-FR')} FCFA</p>
            </div>
            <p style="color:#6b7280;font-size:.9rem">Les fonds sont en séquestre sécurisé et seront libérés une fois la mission validée par le client.</p>
            <a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">Voir sur SkillConnect</a>
            <p style="color:#9ca3af;font-size:.8rem;margin-top:24px">SkillConnect — La plateforme des talents camerounais</p>
          </div>`
        );
      } else if (failed) {
        await db.updateTransactionStatus(tx.id, 'cancelled');
        const userId = tx.type === 'deposit' ? tx.receiver_id : tx.sender_id;
        emitToUser(userId, 'payment_failed', { txId: tx.id });
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Webhook Monetbil error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
app.put('/api/reviews/:id/reply', authenticateToken, async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply?.trim()) return res.status(400).json({ error: 'Réponse requise.' });
    await db.replyToReview(req.params.id, req.user.userId, reply.trim());
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

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

    const review = await db.createReview({ ...req.body, reviewerId: req.user.userId });
    emitToUser(req.body.talentId, 'new_notification', {
      type: 'review',
      message: `Vous avez reçu un nouvel avis ${req.body.rating} étoile${req.body.rating > 1 ? 's' : ''} ⭐`,
    });
    const talentUser = await db.getTalentById(parseInt(req.body.talentId));
    const reviewer   = await db.getTalentById(req.user.userId);
    if (talentUser?.email) sendEmail(talentUser.email,
      `Nouvel avis ${req.body.rating}⭐ reçu — SkillConnect`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#1D9E75">SkillConnect</h2><p>Bonjour ${talentUser.prenom},</p><p><strong>${reviewer?.prenom||'Un utilisateur'}</strong> vous a laissé un avis <strong>${req.body.rating} étoile${req.body.rating>1?'s':''}</strong> ⭐</p>${req.body.comment?`<blockquote style="border-left:3px solid #1D9E75;padding:.5rem 1rem;color:#555;margin:1rem 0">${req.body.comment}</blockquote>`:''}</div>`
    );
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

// ─── Villes disponibles ───────────────────────────────────────────────────────
app.get('/api/villes', async (req, res) => {
  try { res.json(await db.getVilles()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Portfolio ────────────────────────────────────────────────────────────────
app.get('/api/portfolio/:talentId', async (req, res) => {
  try { res.json(await db.getPortfolio(parseInt(req.params.talentId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/portfolio', authenticateToken, async (req, res) => {
  try {
    const { title, description, image } = req.body;
    if (image && image.length > 7_000_000)
      return res.status(413).json({ error: 'Image trop lourde (max 5 Mo).' });
    const item = await db.createPortfolioItem({
      talentId: req.user.userId, title, description, image,
    });
    res.json({ success: true, item });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/portfolio/:id', authenticateToken, async (req, res) => {
  try {
    const ok = await db.deletePortfolioItem(req.params.id, req.user.userId);
    if (!ok) return res.status(404).json({ error: 'Élément non trouvé.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────
const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;
if (googleClient) console.log('✅ Google OAuth activé');
else              console.log('ℹ️  Google OAuth désactivé (configurez GOOGLE_CLIENT_ID dans .env)');

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

app.post('/api/auth/google', authLimiter, async (req, res) => {
  if (!googleClient) return res.status(503).json({ error: 'Google OAuth non configuré sur ce serveur.' });
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Token Google manquant.' });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, given_name, family_name, picture, email_verified } = payload;
    if (!email_verified) return res.status(400).json({ error: 'Email Google non vérifié.' });

    const user = await db.findOrCreateGoogleUser({
      email,
      prenom: given_name || '',
      nom:    family_name || '',
      photo:  picture || null,
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, token, isNew: user.isNew,
      user: {
        id: user.id, prenom: user.prenom, nom: user.nom, email: user.email,
        skill: user.skill || '', initials: user.initials,
        bg_color: user.bg_color, text_color: user.text_color, photo: user.photo,
      },
    });
  } catch (e) {
    console.error('Google auth error:', e.message);
    res.status(400).json({ error: 'Token Google invalide ou expiré.' });
  }
});

// ─── Mot de passe oublié ──────────────────────────────────────────────────────
let mailer = null;
try {
  if (process.env.SMTP_USER && process.env.SMTP_USER !== 'votre@gmail.com') {
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    console.log('✅ Email (nodemailer) activé');
  } else {
    console.log('ℹ️  Email désactivé (configurez SMTP_USER/SMTP_PASS dans .env)');
  }
} catch (e) { console.log('⚠️  Email non disponible :', e.message); }

async function sendEmail(to, subject, html) {
  if (!mailer || !to) return;
  try {
    await mailer.sendMail({ from: `"SkillConnect" <${process.env.SMTP_USER}>`, to, subject, html });
    console.log('📧 Email →', to);
  } catch (e) { console.error('Email erreur :', e.message); }
}

// ─── Vérification email ───────────────────────────────────────────────────────
app.get('/api/auth/verify-email/:token', async (req, res) => {
  try {
    const record = await db.findVerifyToken(req.params.token);
    if (!record) return res.status(400).json({ error: 'Lien invalide ou déjà utilisé.' });
    await db.markEmailVerified(record.user_id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/resend-verify', authenticateToken, async (req, res) => {
  try {
    const user = await db.getTalentById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    if (user.email_verified) return res.json({ success: true, already: true });
    if (!user.email) return res.status(400).json({ error: 'Aucun email associé à ce compte.' });

    const verifyToken = crypto.randomBytes(32).toString('hex');
    await db.createVerifyToken(user.id, verifyToken);
    const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/?verify_token=${verifyToken}`;

    if (mailer) {
      await sendEmail(user.email, 'Vérifiez votre email — SkillConnect',
        `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#1D9E75">SkillConnect</h2><p>Bonjour ${user.prenom},</p><p>Cliquez ci-dessous pour vérifier votre adresse email.</p><a href="${verifyUrl}" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">Vérifier mon email</a></div>`
      );
    } else {
      console.log(`📧 Verify URL pour ${user.email} : ${verifyUrl}`);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });
    const user = await db.findUserByEmail(email);
    // Toujours répondre OK pour ne pas révéler si l'email existe
    if (!user) return res.json({ success: true });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    const expiresStr = expires.toISOString().slice(0, 19).replace('T', ' ');
    await db.createResetToken(user.id, token, expiresStr);

    const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/?reset_token=${token}`;

    if (mailer) {
      console.log(`📧 Envoi reset password → ${email}`);
      await mailer.sendMail({
        from: `"SkillConnect" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Réinitialisation de votre mot de passe SkillConnect',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#1D9E75">SkillConnect</h2>
            <p>Bonjour ${user.prenom},</p>
            <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous :</p>
            <a href="${resetUrl}" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
              Réinitialiser mon mot de passe
            </a>
            <p style="color:#888;font-size:.85rem">Ce lien expire dans 1 heure. Si vous n'avez pas demandé cela, ignorez cet email.</p>
          </div>`,
      });
      console.log(`✅ Email reset envoyé → ${email}`);
    } else {
      console.log(`🔑 Reset token pour ${email} : ${token}`);
      console.log(`   URL : ${resetUrl}`);
    }

    res.json({ success: true });
  } catch (e) {
    console.error('❌ Erreur forgot-password:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis.' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères).' });

    const record = await db.findResetToken(token);
    if (!record) return res.status(400).json({ error: 'Lien invalide ou expiré.' });

    const hash = await bcrypt.hash(password, 10);
    await db.updatePassword(record.user_id, hash);
    await db.markResetTokenUsed(token);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Admin ────────────────────────────────────────────────────────────────────
function authenticateAdmin(req, res, next) {
  const auth  = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token admin manquant' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Accès refusé.' });
    req.admin = payload;
    next();
  } catch { return res.status(401).json({ error: 'Token admin invalide' }); }
}

app.post('/api/admin/auth', authLimiter, (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) return res.status(503).json({ error: 'Accès admin non configuré.' });
  if (password !== adminPass) return res.status(401).json({ error: 'Mot de passe admin incorrect.' });
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token });
});

app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try { res.json(await db.getAdminStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try { res.json(await db.getAllUsers()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id/toggle', authenticateAdmin, async (req, res) => {
  try {
    const user = await db.toggleUserValidation(req.params.id);
    if (user?.validated) {
      const notif = await db.createNotification({
        userId: parseInt(req.params.id),
        type: 'review',
        message: 'Votre profil a été validé par l\'administrateur ! 🎉 Vous apparaissez maintenant dans les résultats.',
        relatedId: parseInt(req.params.id),
      });
      emitToUser(parseInt(req.params.id), 'new_notification', notif);
      if (user.email) sendEmail(
        user.email,
        'Profil validé — SkillConnect',
        `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1D9E75">SkillConnect</h2>
          <p>Bonjour ${user.prenom},</p>
          <p>Bonne nouvelle ! Votre profil SkillConnect vient d'être <strong>validé par notre équipe</strong>.</p>
          <p>Vous apparaissez maintenant dans les résultats de recherche et pouvez recevoir des missions.</p>
          <a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Voir mon profil</a>
        </div>`
      );
    }
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/transactions', authenticateAdmin, async (req, res) => {
  try { res.json(await db.getAllTransactions()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Litiges ──────────────────────────────────────────────────────────────────
app.post('/api/disputes', authenticateToken, async (req, res) => {
  try {
    const { transactionId, reason } = req.body;
    if (!transactionId) return res.status(400).json({ error: 'transactionId requis.' });
    const txList = await db.getTransactions(req.user.userId);
    const tx = txList.find(t => String(t.id) === String(transactionId));
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });
    if (tx.receiver_id !== req.user.userId)
      return res.status(403).json({ error: 'Seul le prestataire peut ouvrir un litige.' });
    if (tx.status !== 'escrow')
      return res.status(400).json({ error: 'La transaction doit être en séquestre.' });
    const existing = await db.getDisputeByTxId(transactionId);
    if (existing) return res.status(409).json({ error: 'Un litige existe déjà pour cette transaction.' });

    const dispute = await db.createDispute({
      transactionId, talentId: req.user.userId, clientId: tx.sender_id, reason,
    });
    const notif = await db.createNotification({
      userId: tx.sender_id,
      type: 'payment',
      message: `Un litige a été ouvert pour "${tx.description}". Connectez-vous pour en savoir plus.`,
      relatedId: tx.id,
    });
    emitToUser(tx.sender_id, 'new_notification', notif);
    res.json({ success: true, dispute });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/disputes/:txId', authenticateToken, async (req, res) => {
  try { res.json(await db.getDisputeByTxId(req.params.txId) || null); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/disputes', authenticateAdmin, async (req, res) => {
  try { res.json(await db.getAllDisputes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/disputes/:id/resolve', authenticateAdmin, async (req, res) => {
  try {
    const { adminNote, resolution } = req.body;
    await db.resolveDispute(req.params.id, adminNote, resolution);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Signalements ─────────────────────────────────────────────────────────────
app.post('/api/reports', authenticateToken, async (req, res) => {
  try {
    const { reportedId, reason, description } = req.body;
    if (!reportedId || !reason) return res.status(400).json({ error: 'reportedId et reason requis.' });
    if (req.user.userId === parseInt(reportedId))
      return res.status(400).json({ error: 'Vous ne pouvez pas vous signaler vous-même.' });
    const report = await db.createReport({
      reporterId: req.user.userId, reportedId: parseInt(reportedId), reason, description,
    });
    res.json({ success: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/reports', authenticateAdmin, async (req, res) => {
  try { res.json(await db.getAllReports()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/reports/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    await db.updateReportStatus(req.params.id, status, adminNote);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/ban', authenticateAdmin, async (req, res) => {
  try {
    const { banType, reason, days } = req.body;
    const banUntil = banType === 'temp' && days
      ? new Date(Date.now() + parseInt(days) * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      : null;
    await db.banUser(req.params.id, banType || 'temp', banUntil, reason, '');
    const user = await db.getTalentById(parseInt(req.params.id));
    if (user?.email) sendEmail(user.email, 'Compte suspendu — SkillConnect',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#e53e3e">SkillConnect — Suspension de compte</h2>
        <p>Bonjour ${user.prenom},</p>
        <p>Votre compte a été <strong>suspendu</strong>${banUntil ? ` jusqu'au ${new Date(banUntil).toLocaleDateString('fr-FR')}` : ' définitivement'}.</p>
        <p><strong>Motif :</strong> ${reason || 'Violation des conditions d\'utilisation.'}</p>
        <p>Si vous pensez qu'il s'agit d'une erreur, contactez-nous à tddmodo@gmail.com.</p>
      </div>`
    );
    const notif = await db.createNotification({ userId: parseInt(req.params.id), type: 'system', message: `Votre compte a été suspendu. Motif : ${reason||'Violation des CGU'}.` });
    emitToUser(parseInt(req.params.id), 'new_notification', notif);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id/ban', authenticateAdmin, async (req, res) => {
  try {
    await db.unbanUser(req.params.id);
    const user = await db.getTalentById(parseInt(req.params.id));
    if (user?.email) sendEmail(user.email, 'Compte réactivé — SkillConnect',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1D9E75">SkillConnect</h2>
        <p>Bonjour ${user.prenom},</p>
        <p>Votre compte a été <strong>réactivé</strong>. Vous pouvez à nouveau vous connecter.</p>
      </div>`
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/bans', authenticateAdmin, async (req, res) => {
  try { res.json(await db.getAllBans()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Statut en ligne ─────────────────────────────────────────────────────────
app.get('/api/online-users', (req, res) => {
  res.json(Object.keys(userSockets).map(id => parseInt(id)));
});

// ─── Stats publiques homepage ─────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try { res.json(await db.getSiteStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Marquer mission livrée ───────────────────────────────────────────────────
app.put('/api/transactions/:id/deliver', authenticateToken, async (req, res) => {
  try {
    const txList = await db.getTransactions(req.user.userId);
    const tx = txList.find(t => String(t.id) === String(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });
    if (tx.receiver_id !== req.user.userId)
      return res.status(403).json({ error: 'Seul le prestataire peut marquer la livraison.' });
    if (tx.status !== 'escrow')
      return res.status(400).json({ error: 'La transaction doit être en séquestre.' });

    await db.updateTransactionStatus(req.params.id, 'delivered');

    const sender = await db.getTalentById(tx.sender_id);
    const receiver = await db.getTalentById(tx.receiver_id);
    const notif = await db.createNotification({
      userId: tx.sender_id,
      type: 'payment',
      message: `${receiver?.prenom || 'Le talent'} a livré la mission "${tx.description}". Validez pour libérer les fonds.`,
      relatedId: tx.id,
    });
    emitToUser(tx.sender_id, 'new_notification', notif);
    if (sender?.email) sendEmail(sender.email,
      `Mission livrée — validez pour libérer les fonds`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#1D9E75">SkillConnect</h2><p>Bonjour ${sender.prenom},</p><p><strong>${receiver?.prenom||'Le talent'}</strong> vient de marquer la mission <strong>"${tx.description}"</strong> comme livrée.</p><p>Connectez-vous pour valider et libérer les fonds.</p><a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Valider la mission</a></div>`
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Conflits de réservation : missions actives d'un talent ──────────────────
app.get('/api/talents/:id/active-missions', async (req, res) => {
  try {
    const count = await db.getTalentActiveCount(parseInt(req.params.id));
    res.json({ count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Offres de missions ───────────────────────────────────────────────────────
app.get('/api/jobs', async (req, res) => {
  try { res.json(await db.getJobs(req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['title', 'budget']);
    if (err) return res.status(400).json({ error: err });
    const job = await db.createJobPost({ ...req.body, clientId: req.user.userId });
    res.json({ success: true, job });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await db.getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Offre non trouvée.' });
    const applications = await db.getJobApplications(req.params.id);
    res.json({ ...job, applications });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/jobs/:id/apply', authenticateToken, async (req, res) => {
  try {
    const job = await db.getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Offre non trouvée.' });
    if (job.client_id === req.user.userId)
      return res.status(400).json({ error: 'Vous ne pouvez pas postuler à votre propre offre.' });
    if (job.status !== 'open')
      return res.status(400).json({ error: 'Cette offre est fermée.' });
    const application = await db.applyToJob({
      jobId: req.params.id, talentId: req.user.userId, message: req.body.message,
    });
    const talent = await db.getTalentById(req.user.userId);
    const notif = await db.createNotification({
      userId: job.client_id,
      type: 'message',
      message: `${talent?.prenom||'Un talent'} a postulé à votre offre "${job.title}"`,
      relatedId: parseInt(req.params.id),
    });
    emitToUser(job.client_id, 'new_notification', notif);
    // Email au client
    const client = await db.getTalentById(job.client_id);
    if (client?.email) sendEmail(
      client.email,
      `Nouvelle candidature — "${job.title}"`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1D9E75">SkillConnect</h2>
        <p>Bonjour ${client.prenom},</p>
        <p><strong>${talent?.prenom||'Un talent'} ${talent?.nom||''}</strong> a postulé à votre offre <strong>"${job.title}"</strong>.</p>
        ${req.body.message ? `<blockquote style="border-left:3px solid #1D9E75;padding:.5rem 1rem;color:#555;margin:1rem 0">${req.body.message}</blockquote>` : ''}
        <p>Connectez-vous pour consulter sa candidature et y répondre.</p>
        <a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Voir la candidature</a>
      </div>`
    );
    res.json({ success: true, application });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Vous avez déjà postulé à cette offre.' });
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/my-jobs/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { res.json(await db.getMyJobPosts(req.params.userId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my-applications/:userId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { res.json(await db.getMyApplications(req.params.userId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/jobs/:id/close', authenticateToken, async (req, res) => {
  try {
    await db.closeJobPost(req.params.id, req.user.userId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/jobs/:id/applications/:appId', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body; // 'accepted' | 'rejected'
    if (!['accepted', 'rejected'].includes(status))
      return res.status(400).json({ error: 'Statut invalide.' });
    const job = await db.getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Offre non trouvée.' });
    if (parseInt(job.client_id) !== req.user.userId)
      return res.status(403).json({ error: 'Accès refusé.' });
    // Vérifie que la candidature appartient bien à ce job
    const apps = await db.getJobApplications(req.params.id);
    const app_ = apps.find(a => a.id === parseInt(req.params.appId));
    if (!app_) return res.status(404).json({ error: 'Candidature non trouvée pour cette offre.' });
    await db.updateApplicationStatus(req.params.appId, status);

    // Quand une candidature est acceptée : fermer l'offre + rejeter les autres candidatures
    if (status === 'accepted') {
      await db.closeJobPost(req.params.id, req.user.userId);
      // Notifier les autres candidats du refus
      const otherApps = apps.filter(a => a.id !== parseInt(req.params.appId) && a.status === 'pending');
      for (const other of otherApps) {
        await db.updateApplicationStatus(other.id, 'rejected');
        const n = await db.createNotification({
          userId: other.talent_id,
          type: 'message',
          message: `Votre candidature pour "${job.title}" n'a pas été retenue.`,
          relatedId: parseInt(req.params.id),
        });
        emitToUser(other.talent_id, 'new_notification', n);
      }
    }

    const notif = await db.createNotification({
      userId: app_.talent_id,
      type: 'message',
      message: status === 'accepted'
        ? `Votre candidature pour "${job.title}" a été acceptée ! 🎉`
        : `Votre candidature pour "${job.title}" n'a pas été retenue.`,
      relatedId: parseInt(req.params.id),
    });
    emitToUser(app_.talent_id, 'new_notification', notif);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Carte des talents ────────────────────────────────────────────────────────
app.get('/api/talents/carte', async (req, res) => {
  try {
    const { competence, budget_max, ville } = req.query;
    const talents = await db.getTalentsForCarte({
      competence: competence || '',
      budgetMax:  budget_max ? parseInt(budget_max) : null,
      ville:      ville || '',
    });
    res.json(talents);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Détail transaction pour rapport PDF ──────────────────────────────────────
app.get('/api/transactions/:id/detail', authenticateToken, async (req, res) => {
  try {
    const tx = await db.getTransactionDetail(parseInt(req.params.id), req.user.userId);
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });
    res.json(tx);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Missions Groupées ────────────────────────────────────────────────────────
app.post('/api/grouped-missions', authenticateToken, async (req, res) => {
  try {
    const { titre, description, talents } = req.body;
    if (!titre || !talents?.length)
      return res.status(400).json({ error: 'Titre et au moins un talent requis.' });

    const mission = await db.createGroupedMission({
      clientId: req.user.userId, titre, description
    });

    const results = [];
    for (const t of talents) {
      const entry = await db.addTalentToGroupedMission({
        missionId: mission.id,
        talentId:  t.talentId,
        role:      t.role || '',
        montant:   t.montant || 0,
      });
      results.push(entry);
    }

    res.json({ success: true, mission: { ...mission, talents: results } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/grouped-missions', authenticateToken, async (req, res) => {
  try {
    res.json(await db.getGroupedMissionsForClient(req.user.userId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/grouped-missions/:id', authenticateToken, async (req, res) => {
  try {
    const gm = await db.getGroupedMission(parseInt(req.params.id));
    if (!gm) return res.status(404).json({ error: 'Mission groupée non trouvée.' });
    if (gm.client_id !== req.user.userId) return res.status(403).json({ error: 'Accès refusé.' });
    res.json(gm);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Blocage utilisateurs ─────────────────────────────────────────────────────
app.post('/api/users/:id/block', authenticateToken, async (req, res) => {
  const blockedId = parseInt(req.params.id);
  if (blockedId === req.user.userId) return res.status(400).json({ error: 'Impossible de se bloquer soi-même.' });
  try { await db.blockUser(req.user.userId, blockedId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id/block', authenticateToken, async (req, res) => {
  try { await db.unblockUser(req.user.userId, parseInt(req.params.id)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/blocked', authenticateToken, async (req, res) => {
  try { res.json(await db.getBlockedIds(req.user.userId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Suppression de conversation ──────────────────────────────────────────────
app.delete('/api/messages/:userId/:contactId', authenticateToken, async (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { await db.deleteConversation(req.params.userId, req.params.contactId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Push Notifications (VAPID) ───────────────────────────────────────────────
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC || null });
});

app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
  try {
    await db.savePushSubscription(req.user.userId, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/push/subscribe', authenticateToken, async (req, res) => {
  try {
    await db.deletePushSubscription(req.user.userId, req.body.endpoint);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Sitemap XML ──────────────────────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const [talents] = await require('./db/database').pool?.execute('SELECT id FROM users WHERE validated = 1').catch(()=>[[],[]]) || [[],[]];
    const base = process.env.APP_URL || 'http://localhost:3000';
    const urls = [
      `<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      ...((talents||[]).map(t => `<url><loc>${base}/?profil=${t.id}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`)),
    ];
    res.setHeader('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch(e) { res.status(500).send(''); }
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
