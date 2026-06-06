const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULT_DATA = {
  users: [],
  messages: [],
  missions: [],
  transactions: [],
  reviews: [],
  notifications: [],
  _nextId: { users: 11, messages: 100, missions: 20, transactions: 10, reviews: 1, notifications: 1 }
};

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Erreur lecture DB:', e.message); }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function save(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('Erreur écriture DB:', e.message); }
}

function nextId(data, table) {
  if (!data._nextId[table]) data._nextId[table] = 1;
  const id = data._nextId[table]++;
  save(data);
  return id;
}

// ─── Seed données initiales ───────────────────────────────────────────────────
function seedIfEmpty() {
  const data = load();
  if (data.users.length > 0) return;

  const COLORS = [
    {bg:'#C8EFE3',col:'#085041'},{bg:'#EEEDFE',col:'#3C3489'},
    {bg:'#FAEEDA',col:'#633806'},{bg:'#FAECE7',col:'#712B13'},
    {bg:'#E8F4FD',col:'#1A5276'},{bg:'#FEF9E7',col:'#7D6608'},
  ];

  data.users = [
    {id:1,prenom:'Amina',nom:'Mbarga',ville:'Yaoundé',skill:'Cours de maths',tarif:5000,tarif_unit:'par heure',phone:'677000001',mm_network:'MTN MoMo',bio:"Diplômée de l'université de Yaoundé I en mathématiques. 4 ans d'expérience en cours particuliers pour lycéens et étudiants.",email:'amina@skillconnect.cm',initials:'AM',bg_color:'#C8EFE3',text_color:'#085041',rating:4.9,reviews:38,badge:'mm',cat:'Cours',validated:1,availability:'available',photo:null},
    {id:2,prenom:'Kevin',nom:'Nkomo',ville:'Douala',skill:'Graphiste UI/UX',tarif:15000,tarif_unit:'par mission',phone:'677000002',mm_network:'MTN MoMo',bio:"Designer UI/UX avec 3 ans d'expérience dans la création de logos, flyers et interfaces web pour des PME camerounaises.",email:'kevin@skillconnect.cm',initials:'KN',bg_color:'#EEEDFE',text_color:'#3C3489',rating:4.7,reviews:21,badge:'mm',cat:'Design',validated:1,availability:'available',photo:null},
    {id:3,prenom:'Sandrine',nom:'Foto',ville:'Bafoussam',skill:'Couture & retouches',tarif:8000,tarif_unit:'par mission',phone:'677000003',mm_network:'Orange Money',bio:'Couturière diplômée spécialisée en retouches et confection sur mesure pour hommes et femmes.',email:'sandrine@skillconnect.cm',initials:'SF',bg_color:'#FAEEDA',text_color:'#633806',rating:5.0,reviews:4,badge:'new',cat:'Couture',validated:1,availability:'busy',photo:null},
    {id:4,prenom:'Eric',nom:'Biya',ville:'Yaoundé',skill:'Dev web (React/Node)',tarif:25000,tarif_unit:'par mission',phone:'677000004',mm_network:'MTN MoMo',bio:"Développeur full-stack avec 4 ans d'expérience. Spécialisé React, Node.js et bases de données.",email:'eric@skillconnect.cm',initials:'EB',bg_color:'#FAECE7',text_color:'#712B13',rating:4.8,reviews:12,badge:'mm',cat:'Informatique',validated:1,availability:'available',photo:null},
    {id:5,prenom:'Fatima',nom:'Coulibaly',ville:'Douala',skill:"Cours d'anglais",tarif:4000,tarif_unit:'par heure',phone:'677000005',mm_network:'Orange Money',bio:"Professeure d'anglais certifiée (DELF B2). 5 ans d'expérience dans la préparation aux examens.",email:'fatima@skillconnect.cm',initials:'FC',bg_color:'#C8EFE3',text_color:'#085041',rating:4.6,reviews:29,badge:'mm',cat:'Cours',validated:1,availability:'available',photo:null},
    {id:6,prenom:'René-Luc',nom:'Atanga',ville:'Yaoundé',skill:'Photographie pro',tarif:20000,tarif_unit:'par mission',phone:'677000006',mm_network:'MTN MoMo',bio:"Photographe professionnel spécialisé dans les portraits, les événements d'entreprise et la publicité.",email:'rene@skillconnect.cm',initials:'RL',bg_color:'#EEEDFE',text_color:'#3C3489',rating:4.9,reviews:8,badge:'new',cat:'Photo',validated:1,availability:'pause',photo:null},
    {id:7,prenom:'Jean-Paul',nom:'Tchamba',ville:'Douala',skill:'Réparation informatique',tarif:10000,tarif_unit:'par mission',phone:'677000007',mm_network:'MTN MoMo',bio:"Technicien informatique avec 6 ans d'expérience. Réparation PC, Mac, installation logiciels.",email:'jptchamba@skillconnect.cm',initials:'JT',bg_color:'#FAEEDA',text_color:'#633806',rating:4.5,reviews:17,badge:'mm',cat:'Informatique',validated:1,availability:'available',photo:null},
    {id:8,prenom:'Marie',nom:'Ngo Biyong',ville:'Yaoundé',skill:'Traduction FR/EN',tarif:3000,tarif_unit:'par page',phone:'677000008',mm_network:'Orange Money',bio:'Traductrice certifiée français-anglais avec spécialisation juridique et commerciale.',email:'marie@skillconnect.cm',initials:'MN',bg_color:'#FAECE7',text_color:'#712B13',rating:4.8,reviews:11,badge:'mm',cat:'Autres',validated:1,availability:'available',photo:null},
    {id:9,prenom:'Blaise',nom:'Kamga',ville:'Bafoussam',skill:'Coaching sportif',tarif:6000,tarif_unit:'par heure',phone:'677000009',mm_network:'MTN MoMo',bio:"Coach sportif certifié, spécialisé fitness et musculation. 7 ans d'expérience.",email:'blaise@skillconnect.cm',initials:'BK',bg_color:'#E8F4FD',text_color:'#1A5276',rating:4.7,reviews:15,badge:'mm',cat:'Autres',validated:1,availability:'available',photo:null},
    {id:10,prenom:'Carine',nom:'Essama',ville:'Yaoundé',skill:'Cuisine & traiteur',tarif:12000,tarif_unit:'par événement',phone:'677000010',mm_network:'MTN MoMo',bio:'Cheffe cuisinière spécialisée dans la cuisine camerounaise et internationale.',email:'carine@skillconnect.cm',initials:'CE',bg_color:'#FEF9E7',text_color:'#7D6608',rating:4.9,reviews:23,badge:'mm',cat:'Autres',validated:1,availability:'available',photo:null},
  ];

  data.messages = [
    {id:1,sender_id:2,receiver_id:1,text:"Bonjour ! J'ai vu votre profil sur SkillConnect. Est-ce que vous êtes disponible pour un cours de maths ce samedi ?",read:1,sent_at:'2026-06-05T10:32:00'},
    {id:2,sender_id:1,receiver_id:2,text:"Bonjour ! Oui, je suis disponible samedi. Quel niveau et quelle durée souhaitez-vous ?",read:1,sent_at:'2026-06-05T10:35:00'},
    {id:3,sender_id:2,receiver_id:1,text:"Mon fils est en terminale C. On aurait besoin d'environ 2h de cours sur les intégrales.",read:1,sent_at:'2026-06-05T10:38:00'},
    {id:4,sender_id:1,receiver_id:2,text:"Parfait ! Ça sera 10 000 FCFA pour 2h. Vous pouvez payer via MTN MoMo directement sur la plateforme.",read:1,sent_at:'2026-06-05T10:40:00'},
    {id:5,sender_id:2,receiver_id:1,text:"D'accord, c'est bon pour moi. Je vais réserver tout de suite via SkillConnect.",read:1,sent_at:'2026-06-05T10:42:00'},
    {id:6,sender_id:4,receiver_id:1,text:"Bonjour Amina, j'ai besoin d'un prof de maths pour ma petite sœur. Vous êtes disponible en semaine ?",read:0,sent_at:'2026-06-05T14:20:00'},
    {id:7,sender_id:1,receiver_id:4,text:"Oui, je suis disponible du lundi au vendredi de 16h à 19h. Quel niveau est-elle ?",read:0,sent_at:'2026-06-05T14:25:00'},
    {id:8,sender_id:5,receiver_id:1,text:"Salut ! Est-ce que tu fais aussi des cours de physique-chimie ?",read:0,sent_at:'2026-06-05T15:05:00'},
  ];

  data.missions = [
    {id:1,client_id:2,talent_id:1,title:'Cours de maths (2h)',amount:10000,status:'completed'},
    {id:2,client_id:3,talent_id:1,title:"Cours d'algèbre (1h)",amount:5000,status:'completed'},
    {id:3,client_id:4,talent_id:1,title:'BAC blanc maths',amount:15000,status:'completed'},
    {id:4,client_id:5,talent_id:1,title:'Cours statistiques (1h)',amount:5000,status:'completed'},
    {id:5,client_id:6,talent_id:1,title:'Préparation examen (3h)',amount:15000,status:'completed'},
    {id:6,client_id:7,talent_id:1,title:'Cours de maths (1h)',amount:5000,status:'in_progress'},
    {id:7,client_id:8,talent_id:1,title:'Session révisions BAC',amount:10000,status:'pending'},
  ];

  data.transactions = [
    {id:1,sender_id:2,receiver_id:1,amount:10000,commission:700,net_amount:9300,description:'Cours de maths (2h)',network:'MTN MoMo',status:'completed',created_at:'2026-06-01T10:00:00'},
    {id:2,sender_id:3,receiver_id:1,amount:5000,commission:350,net_amount:4650,description:"Cours d'algèbre (1h)",network:'Orange Money',status:'completed',created_at:'2026-06-02T14:00:00'},
    {id:3,sender_id:4,receiver_id:1,amount:15000,commission:1050,net_amount:13950,description:'BAC blanc maths (3h)',network:'MTN MoMo',status:'escrow',created_at:'2026-06-04T09:00:00'},
    {id:4,sender_id:5,receiver_id:1,amount:5000,commission:350,net_amount:4650,description:'Cours statistiques (1h)',network:'Orange Money',status:'completed',created_at:'2026-06-03T16:00:00'},
    {id:5,sender_id:6,receiver_id:1,amount:15000,commission:1050,net_amount:13950,description:'Préparation examen (3h)',network:'MTN MoMo',status:'completed',created_at:'2026-05-28T10:00:00'},
    {id:6,sender_id:1,receiver_id:2,amount:15000,commission:1050,net_amount:13950,description:'Logo entreprise',network:'MTN MoMo',status:'completed',created_at:'2026-05-20T09:00:00'},
    {id:7,sender_id:1,receiver_id:4,amount:25000,commission:1750,net_amount:23250,description:'Site vitrine (5 pages)',network:'MTN MoMo',status:'escrow',created_at:'2026-06-03T11:00:00'},
  ];

  data.reviews = [
    {id:1,talent_id:1,reviewer_id:2,reviewer_name:'Kevin N.',reviewer_initials:'KN',reviewer_bg:'#EEEDFE',reviewer_col:'#3C3489',rating:5,comment:'Amina est une excellente prof ! Très patiente et pédagogue. Mon fils a eu 14/20 à son examen.',transaction_id:1,created_at:'2026-06-01T12:00:00'},
    {id:2,talent_id:1,reviewer_id:3,reviewer_name:'Sandrine F.',reviewer_initials:'SF',reviewer_bg:'#FAEEDA',reviewer_col:'#633806',rating:5,comment:'Cours très bien expliqués, ma fille progresse vite. Je recommande vivement !',transaction_id:2,created_at:'2026-06-02T16:30:00'},
    {id:3,talent_id:1,reviewer_id:5,reviewer_name:'Fatima C.',reviewer_initials:'FC',reviewer_bg:'#C8EFE3',reviewer_col:'#085041',rating:4,comment:'Très compétente et disponible. Le seul bémol est la ponctualité mais les cours sont top.',transaction_id:4,created_at:'2026-06-03T18:00:00'},
  ];

  data.notifications = [
    {id:1,user_id:1,type:'payment',message:'Vous avez reçu 9 300 FCFA de Kevin N. pour "Cours de maths (2h)"',read:1,created_at:'2026-06-01T10:05:00'},
    {id:2,user_id:1,type:'review',message:'Kevin N. vous a laissé un avis 5 étoiles ⭐',read:1,created_at:'2026-06-01T12:00:00'},
    {id:3,user_id:1,type:'message',message:'Nouveau message de Eric Biya',read:0,created_at:'2026-06-05T14:20:00'},
    {id:4,user_id:1,type:'message',message:'Nouveau message de Fatima Coulibaly',read:0,created_at:'2026-06-05T15:05:00'},
  ];

  data._nextId = { users: 11, messages: 9, missions: 8, transactions: 8, reviews: 4, notifications: 5 };
  save(data);
  console.log('✅ Base de données initialisée avec les données de démo');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MAIN_CATS = ['Cours','Design','Informatique','Couture','Photo'];

function mapSkillToCat(skill) {
  if (!skill) return 'Autres';
  const s = skill.toLowerCase();
  if (s.includes('cours') || s.includes('prof') || s.includes('enseign')) return 'Cours';
  if (s.includes('design') || s.includes('graphi') || s.includes('figma') || s.includes('logo')) return 'Design';
  if (s.includes('web') || s.includes('dev') || s.includes('code') || s.includes('programm') || s.includes('informatique') || s.includes('répar')) return 'Informatique';
  if (s.includes('couture') || s.includes('retouche') || s.includes('confect') || s.includes('tissu')) return 'Couture';
  if (s.includes('photo') || s.includes('vidéo') || s.includes('video') || s.includes('film')) return 'Photo';
  return 'Autres';
}

const COLORS = [
  {bg:'#C8EFE3',col:'#085041'},{bg:'#EEEDFE',col:'#3C3489'},
  {bg:'#FAEEDA',col:'#633806'},{bg:'#FAECE7',col:'#712B13'},
  {bg:'#E8F4FD',col:'#1A5276'},{bg:'#FEF9E7',col:'#7D6608'},
];

function fmtISO() { return new Date().toISOString(); }

// ─── Talents ──────────────────────────────────────────────────────────────────
function getTalents({ cat, q } = {}) {
  const data = load();
  let list = data.users.filter(u => u.validated === 1);

  if (cat && cat !== 'Tous') {
    if (cat === 'Autres') {
      list = list.filter(u => !MAIN_CATS.includes(u.cat));
    } else {
      list = list.filter(u => u.cat === cat);
    }
  }

  if (q) {
    const lq = q.toLowerCase();
    list = list.filter(u =>
      u.prenom.toLowerCase().includes(lq) ||
      u.nom.toLowerCase().includes(lq) ||
      u.skill.toLowerCase().includes(lq) ||
      u.ville.toLowerCase().includes(lq)
    );
  }

  return list.sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
}

function getTalentById(id) {
  return load().users.find(u => u.id === id) || null;
}

function createUser(body) {
  const data = load();
  const { prenom, nom, ville, skill, skill_custom, tarif, tarif_unit, phone, mm_network, bio, email } = body;
  const skillName = skill === 'Autres' ? (skill_custom || 'Autre compétence') : skill;
  const cat = mapSkillToCat(skillName);
  const initials = ((prenom || ' ')[0] + (nom || ' ')[0]).toUpperCase();
  const color = COLORS[data.users.length % COLORS.length];

  const user = {
    id: data._nextId.users++,
    prenom, nom, ville,
    skill: skillName,
    skill_custom: skill_custom || null,
    tarif: parseInt(tarif) || 0,
    tarif_unit: tarif_unit || 'par heure',
    phone, mm_network: mm_network || 'MTN MoMo',
    bio: bio || '', email: email || '',
    initials, bg_color: color.bg, text_color: color.col,
    rating: 5.0, reviews: 0, badge: 'new',
    cat, validated: 1,
    availability: 'available',
    photo: null,
    password_hash: body.password_hash || null,
    created_at: fmtISO(),
  };

  data.users.push(user);
  save(data);
  return { id: user.id, prenom, nom, ville, skill: skillName, cat, initials, bg_color: color.bg, text_color: color.col };
}

function updateUser(id, body) {
  const data = load();
  const idx = data.users.findIndex(u => u.id === id);
  if (idx === -1) return;
  const { bio, tarif, tarif_unit, availability, photo, mm_network, phone } = body;
  if (bio !== undefined) data.users[idx].bio = bio;
  if (tarif !== undefined) data.users[idx].tarif = parseInt(tarif) || 0;
  if (tarif_unit !== undefined) data.users[idx].tarif_unit = tarif_unit;
  if (availability !== undefined) data.users[idx].availability = availability;
  if (photo !== undefined) data.users[idx].photo = photo;
  if (mm_network !== undefined) data.users[idx].mm_network = mm_network;
  if (phone !== undefined) data.users[idx].phone = phone;
  save(data);
}

function findUserByEmail(email) {
  if (!email) return null;
  const data = load();
  return data.users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase()) || null;
}

function deleteUser(userId) {
  const data = load();
  const idx = data.users.findIndex(u => u.id === parseInt(userId));
  if (idx === -1) return false;
  data.users.splice(idx, 1);
  save(data);
  return true;
}

function createWithdrawal({ userId, amount, network, phone }) {
  const data = load();
  const uid = parseInt(userId);
  const amt = parseInt(amount);

  // Vérifier le solde disponible (revenus + dépôts - retraits)
  const txs = data.transactions || [];
  const credits = txs.filter(t => t.receiver_id === uid && t.status === 'completed');
  const debits  = txs.filter(t => t.sender_id === uid && t.type === 'withdrawal');
  const available = credits.reduce((s, t) => s + (t.net_amount || t.amount - t.commission), 0)
                  - debits.reduce((s, t) => s + t.amount, 0);
  if (available < amt) throw new Error('Solde insuffisant');

  const tx = {
    id: data._nextId.transactions++,
    sender_id: uid,
    receiver_id: 0,
    amount: amt,
    commission: 0,
    net_amount: amt,
    description: 'Retrait vers ' + (network || 'Mobile Money'),
    network: network || 'MTN MoMo',
    phone: phone || '',
    type: 'withdrawal',
    status: 'pending',
    created_at: fmtISO(),
  };
  if (!data.transactions) data.transactions = [];
  data.transactions.push(tx);
  save(data);
  return tx;
}

function createDeposit({ userId, amount, network, phone, campay_reference }) {
  const data = load();
  const uid = parseInt(userId);
  const amt = parseInt(amount);

  const tx = {
    id:               data._nextId.transactions++,
    sender_id:        0,
    receiver_id:      uid,
    amount:           amt,
    commission:       0,
    net_amount:       amt,
    description:      'Dépôt depuis ' + (network || 'Mobile Money'),
    network:          network || 'MTN MoMo',
    phone:            phone || '',
    type:             'deposit',
    campay_reference: campay_reference || null,
    // pending si Campay est utilisé, completed en mode simulation
    status:           campay_reference ? 'pending' : 'completed',
    created_at:       fmtISO(),
  };
  if (!data.transactions) data.transactions = [];
  data.transactions.push(tx);
  save(data);
  return tx;
}

function getDashboardData(userId) {
  const data = load();
  const user = data.users.find(u => u.id === userId);
  if (!user) return null;

  const missions = data.missions.filter(m => m.talent_id === userId);
  const completed = missions.filter(m => m.status === 'completed');
  const revenue = completed.reduce((s, m) => s + m.amount, 0);
  const netRevenue = Math.round(revenue * 0.93);

  const unread = data.messages.filter(m => m.receiver_id === userId && !m.read).length;

  const skillMap = {};
  missions.forEach(m => { skillMap[m.title] = (skillMap[m.title] || 0) + 1; });
  const skillStats = Object.entries(skillMap)
    .map(([title, cnt]) => ({ title, cnt }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 5);

  const unreadNotifs = (data.notifications || []).filter(n => n.user_id === userId && !n.read).length;

  return {
    user,
    revenue: netRevenue,
    missions: completed.length,
    pending: missions.filter(m => m.status === 'pending').length,
    rating: user.rating,
    views: 200 + (userId * 47) % 300,
    unread,
    unreadNotifs,
    skillStats,
  };
}

// ─── Messagerie ───────────────────────────────────────────────────────────────
function getContacts(userId) {
  const data = load();
  const seen = new Set();
  const contacts = [];

  data.messages.forEach(m => {
    const otherId = m.sender_id === userId ? m.receiver_id : (m.receiver_id === userId ? m.sender_id : null);
    if (!otherId || otherId === userId || seen.has(otherId)) return;
    seen.add(otherId);

    const other = data.users.find(u => u.id === otherId);
    if (!other) return;

    const thread = data.messages.filter(x =>
      (x.sender_id === userId && x.receiver_id === otherId) ||
      (x.sender_id === otherId && x.receiver_id === userId)
    ).sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));

    const unread = data.messages.filter(x => x.sender_id === otherId && x.receiver_id === userId && !x.read).length;

    contacts.push({
      id: other.id,
      prenom: other.prenom,
      nom: other.nom,
      initials: other.initials,
      bg_color: other.bg_color,
      text_color: other.text_color,
      photo: other.photo || null,
      skill: other.skill,
      ville: other.ville,
      availability: other.availability || 'available',
      last_message: thread[0]?.text || '',
      last_time: thread[0]?.sent_at || null,
      unread,
    });
  });

  return contacts.sort((a, b) => new Date(b.last_time || 0) - new Date(a.last_time || 0));
}

function getMessages(userId, contactId) {
  const data = load();
  return data.messages
    .filter(m =>
      (m.sender_id === userId && m.receiver_id === contactId) ||
      (m.sender_id === contactId && m.receiver_id === userId)
    )
    .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
    .map(m => {
      const sender = data.users.find(u => u.id === m.sender_id) || {};
      return {
        ...m,
        sender_initials: sender.initials || '?',
        sender_bg: sender.bg_color || '#ccc',
        sender_col: sender.text_color || '#000',
        sender_prenom: sender.prenom || '',
        sender_nom: sender.nom || '',
        sender_photo: sender.photo || null,
      };
    });
}

function sendMessage(senderId, receiverId, text) {
  const data = load();
  const msg = {
    id: data._nextId.messages++,
    sender_id: senderId,
    receiver_id: receiverId,
    text,
    read: 0,
    sent_at: fmtISO(),
  };
  data.messages.push(msg);
  save(data);
  return msg;
}

function markAsRead(userId, contactId) {
  const data = load();
  data.messages.forEach(m => {
    if (m.sender_id === contactId && m.receiver_id === userId) m.read = 1;
  });
  save(data);
}

// ─── Reviews ──────────────────────────────────────────────────────────────────
function createReview(body) {
  const data = load();
  if (!data.reviews) data.reviews = [];
  const { talentId, reviewerId, rating, comment, transactionId } = body;
  const reviewer = data.users.find(u => u.id === parseInt(reviewerId));

  const review = {
    id: data._nextId.reviews++,
    talent_id: parseInt(talentId),
    reviewer_id: parseInt(reviewerId),
    reviewer_name: reviewer ? `${reviewer.prenom} ${reviewer.nom[0]}.` : 'Anonyme',
    reviewer_initials: reviewer ? reviewer.initials : '?',
    reviewer_bg: reviewer ? reviewer.bg_color : '#ccc',
    reviewer_col: reviewer ? reviewer.text_color : '#000',
    rating: parseInt(rating),
    comment: comment || '',
    transaction_id: parseInt(transactionId) || null,
    created_at: fmtISO(),
  };

  data.reviews.push(review);

  // Recalculate talent rating
  const talentReviews = data.reviews.filter(r => r.talent_id === parseInt(talentId));
  const avgRating = talentReviews.reduce((s, r) => s + r.rating, 0) / talentReviews.length;
  const tIdx = data.users.findIndex(u => u.id === parseInt(talentId));
  if (tIdx !== -1) {
    data.users[tIdx].rating = Math.round(avgRating * 10) / 10;
    data.users[tIdx].reviews = talentReviews.length;
  }

  // Notification for talent
  if (reviewer) {
    createNotificationInternal(data, {
      userId: parseInt(talentId),
      type: 'review',
      message: `${reviewer.prenom} ${reviewer.nom[0]}. vous a laissé un avis ${rating} étoile${rating > 1 ? 's' : ''} ⭐`,
    });
  }

  save(data);
  return review;
}

function getReviews(talentId) {
  const data = load();
  return (data.reviews || [])
    .filter(r => r.talent_id === parseInt(talentId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ─── Notifications ────────────────────────────────────────────────────────────
function createNotificationInternal(data, { userId, type, message }) {
  if (!data.notifications) data.notifications = [];
  if (!data._nextId.notifications) data._nextId.notifications = 1;
  const notif = {
    id: data._nextId.notifications++,
    user_id: parseInt(userId),
    type,
    message,
    read: 0,
    created_at: fmtISO(),
  };
  data.notifications.push(notif);
  return notif;
}

function createNotification(body) {
  const data = load();
  const notif = createNotificationInternal(data, body);
  save(data);
  return notif;
}

function getNotifications(userId) {
  const data = load();
  return (data.notifications || [])
    .filter(n => n.user_id === parseInt(userId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);
}

function markNotificationRead(notifId) {
  const data = load();
  const n = (data.notifications || []).find(n => n.id === parseInt(notifId));
  if (n) { n.read = 1; save(data); }
}

function markAllNotificationsRead(userId) {
  const data = load();
  (data.notifications || []).forEach(n => {
    if (n.user_id === parseInt(userId)) n.read = 1;
  });
  save(data);
}

// ─── Transactions ─────────────────────────────────────────────────────────────
function createTransaction(body) {
  const data = load();
  const { senderId, receiverId, amount, description, network } = body;
  const commission = Math.round(amount * 0.07);
  const net_amount = amount - commission;
  const tx = {
    id: data._nextId.transactions++,
    sender_id:   parseInt(senderId),
    receiver_id: parseInt(receiverId),
    amount:      parseInt(amount),
    commission,
    net_amount,
    description:       description || '',
    network:           network || 'MTN MoMo',
    status:            'escrow',
    campay_reference:  body.campay_reference || null,
    created_at:        fmtISO(),
  };
  if (!data.transactions) data.transactions = [];
  data.transactions.push(tx);

  // Notifications
  const sender = data.users.find(u => u.id === parseInt(senderId));
  const receiver = data.users.find(u => u.id === parseInt(receiverId));
  if (sender && receiver) {
    createNotificationInternal(data, {
      userId: parseInt(receiverId),
      type: 'payment',
      message: `${sender.prenom} ${sender.nom[0]}. vous a envoyé ${net_amount.toLocaleString('fr-FR')} FCFA pour "${description}"`,
    });
  }

  save(data);
  return tx;
}

function getWallet(userId) {
  const data = load();
  const txs = data.transactions || [];
  const uid = parseInt(userId);
  const earned      = txs.filter(t => t.receiver_id === uid && t.status === 'completed');
  const escrow      = txs.filter(t => t.receiver_id === uid && t.status === 'escrow');
  const spent       = txs.filter(t => t.sender_id   === uid && t.status !== 'cancelled');
  const withdrawals = txs.filter(t => t.sender_id   === uid && t.type === 'withdrawal');
  const totalEarned = earned.reduce((s, t) => s + (t.net_amount || t.amount - t.commission), 0);
  const totalWithdrawn = withdrawals.reduce((s, t) => s + t.amount, 0);
  return {
    available:   totalEarned - totalWithdrawn,
    inEscrow:    escrow.reduce((s, t) => s + (t.net_amount || t.amount - t.commission), 0),
    totalEarned,
    totalSpent:  spent.reduce((s, t) => s + t.amount, 0),
  };
}

function getTransactions(userId) {
  const data = load();
  const txs = data.transactions || [];
  const uid = parseInt(userId);
  return txs
    .filter(t => t.sender_id === uid || t.receiver_id === uid)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function updateTransactionStatus(id, status) {
  const data = load();
  const tx = (data.transactions || []).find(t => t.id === parseInt(id));
  if (!tx) return null;
  tx.status = status;
  if (status === 'completed') tx.completed_at = fmtISO();
  save(data);
  return tx;
}

// ─── Migration ────────────────────────────────────────────────────────────────
function migrateData() {
  const data = load();
  let changed = false;

  if (!data.transactions || data.transactions.length === 0) {
    data.transactions = [
      {id:1,sender_id:2,receiver_id:1,amount:10000,commission:700,net_amount:9300,description:'Cours de maths (2h)',network:'MTN MoMo',status:'completed',created_at:'2026-06-01T10:00:00'},
      {id:2,sender_id:3,receiver_id:1,amount:5000,commission:350,net_amount:4650,description:"Cours d'algèbre (1h)",network:'Orange Money',status:'completed',created_at:'2026-06-02T14:00:00'},
      {id:3,sender_id:4,receiver_id:1,amount:15000,commission:1050,net_amount:13950,description:'BAC blanc maths (3h)',network:'MTN MoMo',status:'escrow',created_at:'2026-06-04T09:00:00'},
      {id:4,sender_id:5,receiver_id:1,amount:5000,commission:350,net_amount:4650,description:'Cours statistiques (1h)',network:'Orange Money',status:'completed',created_at:'2026-06-03T16:00:00'},
      {id:5,sender_id:6,receiver_id:1,amount:15000,commission:1050,net_amount:13950,description:'Préparation examen (3h)',network:'MTN MoMo',status:'completed',created_at:'2026-05-28T10:00:00'},
      {id:6,sender_id:1,receiver_id:2,amount:15000,commission:1050,net_amount:13950,description:'Logo entreprise',network:'MTN MoMo',status:'completed',created_at:'2026-05-20T09:00:00'},
      {id:7,sender_id:1,receiver_id:4,amount:25000,commission:1750,net_amount:23250,description:'Site vitrine (5 pages)',network:'MTN MoMo',status:'escrow',created_at:'2026-06-03T11:00:00'},
    ];
    if (!data._nextId) data._nextId = {};
    data._nextId.transactions = 8;
    changed = true;
  }

  if (!data.reviews) { data.reviews = []; if (!data._nextId) data._nextId = {}; data._nextId.reviews = 1; changed = true; }
  if (!data.notifications) { data.notifications = []; if (!data._nextId) data._nextId = {}; data._nextId.notifications = 1; changed = true; }

  // Add availability to existing users
  if (data.users && data.users.length > 0) {
    data.users.forEach(u => {
      if (u.availability === undefined) { u.availability = 'available'; changed = true; }
      if (u.photo === undefined) { u.photo = null; changed = true; }
    });
  }

  if (!data._nextId) { data._nextId = { users: 11, messages: 100, missions: 20, transactions: 8, reviews: 1, notifications: 1 }; changed = true; }

  if (changed) {
    save(data);
    console.log('✅ Migration DB effectuée');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
seedIfEmpty();
migrateData();

module.exports = {
  getTalents, getTalentById, createUser, updateUser, findUserByEmail, deleteUser,
  getDashboardData,
  getContacts, getMessages, sendMessage, markAsRead,
  createTransaction, getWallet, getTransactions, updateTransactionStatus,
  createWithdrawal, createDeposit,
  createReview, getReviews,
  createNotification, getNotifications, markNotificationRead, markAllNotificationsRead,
};
