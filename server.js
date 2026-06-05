require('dotenv').config();
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const cors    = require('cors');
const db      = require('./db/database');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' })); // 10mb pour les photos base64
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'SkillConnect.html'));
});

// ─── Socket.io — messagerie temps réel ────────────────────────────────────────
const userSockets = {}; // userId → socketId

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
    console.log('ℹ️  SMS désactivé (configurez AT_API_KEY dans .env pour l\'activer)');
  }
} catch (e) {
  console.log('⚠️  Africa\'s Talking non disponible :', e.message);
}

async function sendSMS(phone, message) {
  if (!atSMS || !phone) return;
  try {
    const number = String(phone).replace(/\s/g, '');
    const formatted = number.startsWith('+') ? number : '+237' + number;
    await atSMS.send({ to: [formatted], message, from: 'SkillConnect' });
    console.log('📱 SMS envoyé à', formatted);
  } catch (e) {
    console.error('SMS erreur :', e.message);
  }
}

// ─── Talents ──────────────────────────────────────────────────────────────────
app.get('/api/talents', (req, res) => {
  try { res.json(db.getTalents(req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/talents/:id', (req, res) => {
  const t = db.getTalentById(parseInt(req.params.id));
  if (!t) return res.status(404).json({ error: 'Talent non trouvé' });
  res.json(t);
});

// ─── Inscription ──────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const user = db.createUser(req.body);
    if (user.phone) {
      sendSMS(user.phone,
        `Bienvenue sur SkillConnect, ${user.prenom} ! 🎉\nVotre profil "${user.skill}" est en ligne. Bonne chance !`
      );
    }
    res.json({ success: true, user });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Tableau de bord ──────────────────────────────────────────────────────────
app.get('/api/dashboard/:userId', (req, res) => {
  const data = db.getDashboardData(parseInt(req.params.userId));
  if (!data) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  res.json(data);
});

app.put('/api/profile/:userId', (req, res) => {
  try {
    db.updateUser(parseInt(req.params.userId), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Messagerie ───────────────────────────────────────────────────────────────
app.get('/api/contacts/:userId', (req, res) => {
  try { res.json(db.getContacts(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:userId/:contactId', (req, res) => {
  try {
    res.json(db.getMessages(parseInt(req.params.userId), parseInt(req.params.contactId)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;
    if (!senderId || !receiverId || !text)
      return res.status(400).json({ error: 'Données manquantes' });

    const msg = db.sendMessage(parseInt(senderId), parseInt(receiverId), text);

    // Notification in-app
    const sender = db.getTalentById(parseInt(senderId));
    if (sender) {
      const notif = db.createNotification({
        userId: parseInt(receiverId),
        type: 'message',
        message: `Nouveau message de ${sender.prenom} ${sender.nom}`,
      });
      emitToUser(receiverId, 'new_notification', notif);
    }

    // Socket.io temps réel
    emitToUser(receiverId, 'new_message', {
      ...msg,
      sender_initials: sender?.initials || '?',
      sender_bg: sender?.bg_color || '#ccc',
      sender_col: sender?.text_color || '#000',
      sender_prenom: sender?.prenom || '',
      sender_photo: sender?.photo || null,
    });

    // SMS (uniquement pour réservations)
    const isBooking = text.toLowerCase().includes('réserver une session') || text.toLowerCase().includes('reserver une session');
    if (isBooking) {
      const receiver = db.getTalentById(parseInt(receiverId));
      if (receiver && receiver.phone) {
        sendSMS(receiver.phone,
          `SkillConnect : ${sender ? sender.prenom + ' ' + sender.nom : 'Un utilisateur'} souhaite réserver une session avec vous !`
        );
      }
    }

    res.json({ success: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/messages/read/:userId/:contactId', (req, res) => {
  try {
    db.markAsRead(parseInt(req.params.userId), parseInt(req.params.contactId));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Paiements ────────────────────────────────────────────────────────────────
app.post('/api/pay', async (req, res) => {
  try {
    const tx = db.createTransaction(req.body);

    const sender   = db.getTalentById(tx.sender_id);
    const receiver = db.getTalentById(tx.receiver_id);
    const net      = tx.amount - tx.commission;

    // Émettre la notification au destinataire en temps réel
    emitToUser(tx.receiver_id, 'new_notification', {
      type: 'payment',
      message: `Paiement de ${net.toLocaleString('fr-FR')} FCFA reçu pour "${tx.description}"`,
    });

    if (sender && sender.phone) {
      sendSMS(sender.phone,
        `SkillConnect : Paiement de ${tx.amount.toLocaleString('fr-FR')} FCFA envoyé pour "${tx.description}". Fonds en séquestre.`
      );
    }
    if (receiver && receiver.phone) {
      sendSMS(receiver.phone,
        `SkillConnect : Vous allez recevoir ${net.toLocaleString('fr-FR')} FCFA pour "${tx.description}". Libéré après validation.`
      );
    }

    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/wallet/:userId', (req, res) => {
  try { res.json(db.getWallet(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transactions/:userId', (req, res) => {
  try { res.json(db.getTransactions(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/transactions/:id/status', (req, res) => {
  try {
    const tx = db.updateTransactionStatus(req.params.id, req.body.status);
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
app.get('/api/reviews/:talentId', (req, res) => {
  try { res.json(db.getReviews(parseInt(req.params.talentId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reviews', (req, res) => {
  try {
    const review = db.createReview(req.body);

    // Émettre la notification au talent
    emitToUser(req.body.talentId, 'new_notification', {
      type: 'review',
      message: `Vous avez reçu un nouvel avis ${req.body.rating} étoile${req.body.rating > 1 ? 's' : ''} ⭐`,
    });

    res.json({ success: true, review });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications/:userId', (req, res) => {
  try { res.json(db.getNotifications(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/:id/read', (req, res) => {
  try { db.markNotificationRead(parseInt(req.params.id)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/read-all/:userId', (req, res) => {
  try { db.markAllNotificationsRead(parseInt(req.params.userId)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 SkillConnect démarré → http://localhost:${PORT}\n`);
});
