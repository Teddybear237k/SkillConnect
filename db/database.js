require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'SkillConnect',
  waitForConnections: true,
  connectionLimit:    10,
  charset:            'utf8mb4',
  dateStrings:        true,
});

function fmtISO() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

const MAIN_CATS = ['Cours', 'Design', 'Informatique', 'Couture', 'Photo'];

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

// ─── Init : création des tables + seed ────────────────────────────────────────
async function init() {
  // Connexion sans DB pour créer la base si elle n'existe pas
  const temp = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });
  const dbName = process.env.DB_NAME || 'SkillConnect';
  await temp.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await temp.end();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      prenom        VARCHAR(100),
      nom           VARCHAR(100),
      ville         VARCHAR(100),
      skill         VARCHAR(200),
      skill_custom  VARCHAR(200),
      tarif         INT DEFAULT 0,
      tarif_unit    VARCHAR(50)  DEFAULT 'par heure',
      phone         VARCHAR(30),
      mm_network    VARCHAR(50)  DEFAULT 'MTN MoMo',
      bio           TEXT,
      email          VARCHAR(200),
      initials       VARCHAR(10),
      bg_color       VARCHAR(20),
      text_color     VARCHAR(20),
      rating         DECIMAL(3,1) DEFAULT 5.0,
      reviews        INT          DEFAULT 0,
      badge          VARCHAR(20)  DEFAULT 'new',
      cat            VARCHAR(100) DEFAULT 'Autres',
      validated      TINYINT      DEFAULT 1,
      availability   VARCHAR(20)  DEFAULT 'available',
      photo          LONGTEXT,
      password_hash  VARCHAR(200),
      email_verified TINYINT      DEFAULT 1,
      created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      sender_id   INT DEFAULT 0,
      receiver_id INT DEFAULT 0,
      text        TEXT,
      \`read\`    TINYINT  DEFAULT 0,
      sent_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      file_data   LONGTEXT,
      file_name   VARCHAR(200),
      file_type   VARCHAR(100)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS missions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      client_id  INT DEFAULT 0,
      talent_id  INT DEFAULT 0,
      title      VARCHAR(200),
      amount     INT DEFAULT 0,
      status     VARCHAR(50) DEFAULT 'pending',
      created_at DATETIME    DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      sender_id         INT DEFAULT 0,
      receiver_id       INT DEFAULT 0,
      amount            INT DEFAULT 0,
      commission        INT DEFAULT 0,
      net_amount        INT DEFAULT 0,
      description       TEXT,
      network           VARCHAR(50)  DEFAULT 'MTN MoMo',
      phone             VARCHAR(30),
      type              VARCHAR(30)  DEFAULT 'payment',
      status            VARCHAR(30)  DEFAULT 'escrow',
      campay_reference  VARCHAR(200),
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at      DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      talent_id         INT DEFAULT 0,
      reviewer_id       INT DEFAULT 0,
      reviewer_name     VARCHAR(200),
      reviewer_initials VARCHAR(10),
      reviewer_bg       VARCHAR(20),
      reviewer_col      VARCHAR(20),
      rating            TINYINT DEFAULT 5,
      comment           TEXT,
      transaction_id    INT,
      reply             TEXT,
      reply_at          DATETIME,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT DEFAULT 0,
      type       VARCHAR(50),
      message    TEXT,
      \`read\`   TINYINT  DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      talent_id  INT NOT NULL,
      title      VARCHAR(200),
      description TEXT,
      image      LONGTEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      token      VARCHAR(100) UNIQUE,
      expires_at DATETIME,
      used       TINYINT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migrations — colonnes ajoutées après la création initiale
  try { await pool.query('ALTER TABLE users ADD COLUMN email_verified TINYINT DEFAULT 1'); } catch (_) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN skills TEXT'); } catch (_) {}
  try { await pool.query('ALTER TABLE reviews ADD COLUMN reply TEXT'); } catch (_) {}
  try { await pool.query('ALTER TABLE reviews ADD COLUMN reply_at DATETIME'); } catch (_) {}
  try { await pool.query('ALTER TABLE messages ADD COLUMN file_data LONGTEXT'); } catch (_) {}
  try { await pool.query('ALTER TABLE messages ADD COLUMN file_name VARCHAR(200)'); } catch (_) {}
  try { await pool.query('ALTER TABLE messages ADD COLUMN file_type VARCHAR(100)'); } catch (_) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verify_tokens (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      token      VARCHAR(100) UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS disputes (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      transaction_id INT NOT NULL,
      talent_id      INT NOT NULL,
      client_id      INT NOT NULL,
      reason         TEXT,
      status         VARCHAR(30) DEFAULT 'open',
      admin_note     TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at    DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      reporter_id INT NOT NULL,
      reported_id INT NOT NULL,
      reason      VARCHAR(200),
      description TEXT,
      status      VARCHAR(30) DEFAULT 'pending',
      admin_note  TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bans (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL UNIQUE,
      ban_type   VARCHAR(30) DEFAULT 'temp',
      ban_until  DATETIME,
      reason     TEXT,
      admin_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX(user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_posts (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      client_id    INT NOT NULL,
      title        VARCHAR(200) NOT NULL,
      description  TEXT,
      budget       INT DEFAULT 0,
      budget_type  VARCHAR(50)  DEFAULT 'fixe',
      category     VARCHAR(100) DEFAULT 'Autres',
      ville        VARCHAR(100),
      status       VARCHAR(30)  DEFAULT 'open',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_applications (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      job_id     INT NOT NULL,
      talent_id  INT NOT NULL,
      message    TEXT,
      status     VARCHAR(30) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_apply (job_id, talent_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ── Missions Groupées ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grouped_missions (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      client_id   INT NOT NULL,
      titre       VARCHAR(300) NOT NULL,
      description TEXT,
      statut      VARCHAR(30) DEFAULT 'active',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS grouped_mission_talents (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      mission_id      INT NOT NULL,
      talent_id       INT NOT NULL,
      role            VARCHAR(200),
      montant         INT DEFAULT 0,
      statut_paiement VARCHAR(30) DEFAULT 'pending',
      tx_id           INT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mission (mission_id),
      INDEX idx_talent (talent_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Tables nouvelles
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      blocker_id INT NOT NULL,
      blocked_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_block (blocker_id, blocked_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      endpoint   TEXT NOT NULL,
      p256dh     TEXT,
      auth       TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_endpoint (user_id, endpoint(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile_views (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      talent_id  INT NOT NULL,
      viewer_id  INT,
      viewed_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_talent (talent_id),
      INDEX idx_viewed (talent_id, viewed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migrations non-destructives
  try { await pool.execute('ALTER TABLE job_posts ADD COLUMN deadline_days INT DEFAULT NULL'); } catch(e) {}
  try { await pool.execute('ALTER TABLE messages ADD COLUMN reply_to_id INT NULL DEFAULT NULL'); } catch(e) {}
  try { await pool.execute('ALTER TABLE users ADD COLUMN last_seen DATETIME NULL'); } catch(e) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      message_id INT NOT NULL,
      user_id    INT NOT NULL,
      emoji      VARCHAR(10) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_reaction (message_id, user_id),
      INDEX idx_msg (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM users');
  if (cnt === 0) await seedData();

  console.log('✅ Base de données MySQL connectée et initialisée');
}

async function seedData() {
  const users = [
    [1,'Amina','Mbarga','Yaoundé','Cours de maths',null,5000,'par heure','677000001','MTN MoMo',"Diplômée de l'université de Yaoundé I en mathématiques. 4 ans d'expérience en cours particuliers pour lycéens et étudiants.",'amina@skillconnect.cm','AM','#C8EFE3','#085041',4.9,38,'mm','Cours',1,'available',null,null],
    [2,'Kevin','Nkomo','Douala','Graphiste UI/UX',null,15000,'par mission','677000002','MTN MoMo',"Designer UI/UX avec 3 ans d'expérience dans la création de logos, flyers et interfaces web pour des PME camerounaises.",'kevin@skillconnect.cm','KN','#EEEDFE','#3C3489',4.7,21,'mm','Design',1,'available',null,null],
    [3,'Sandrine','Foto','Bafoussam','Couture & retouches',null,8000,'par mission','677000003','Orange Money','Couturière diplômée spécialisée en retouches et confection sur mesure pour hommes et femmes.','sandrine@skillconnect.cm','SF','#FAEEDA','#633806',5.0,4,'new','Couture',1,'busy',null,null],
    [4,'Eric','Biya','Yaoundé','Dev web (React/Node)',null,25000,'par mission','677000004','MTN MoMo',"Développeur full-stack avec 4 ans d'expérience. Spécialisé React, Node.js et bases de données.",'eric@skillconnect.cm','EB','#FAECE7','#712B13',4.8,12,'mm','Informatique',1,'available',null,null],
    [5,'Fatima','Coulibaly','Douala',"Cours d'anglais",null,4000,'par heure','677000005','Orange Money',"Professeure d'anglais certifiée (DELF B2). 5 ans d'expérience dans la préparation aux examens.",'fatima@skillconnect.cm','FC','#C8EFE3','#085041',4.6,29,'mm','Cours',1,'available',null,null],
    [6,'René-Luc','Atanga','Yaoundé','Photographie pro',null,20000,'par mission','677000006','MTN MoMo',"Photographe professionnel spécialisé dans les portraits, les événements d'entreprise et la publicité.",'rene@skillconnect.cm','RL','#EEEDFE','#3C3489',4.9,8,'new','Photo',1,'pause',null,null],
    [7,'Jean-Paul','Tchamba','Douala','Réparation informatique',null,10000,'par mission','677000007','MTN MoMo',"Technicien informatique avec 6 ans d'expérience. Réparation PC, Mac, installation logiciels.",'jptchamba@skillconnect.cm','JT','#FAEEDA','#633806',4.5,17,'mm','Informatique',1,'available',null,null],
    [8,'Marie','Ngo Biyong','Yaoundé','Traduction FR/EN',null,3000,'par page','677000008','Orange Money','Traductrice certifiée français-anglais avec spécialisation juridique et commerciale.','marie@skillconnect.cm','MN','#FAECE7','#712B13',4.8,11,'mm','Autres',1,'available',null,null],
    [9,'Blaise','Kamga','Bafoussam','Coaching sportif',null,6000,'par heure','677000009','MTN MoMo',"Coach sportif certifié, spécialisé fitness et musculation. 7 ans d'expérience.",'blaise@skillconnect.cm','BK','#E8F4FD','#1A5276',4.7,15,'mm','Autres',1,'available',null,null],
    [10,'Carine','Essama','Yaoundé','Cuisine & traiteur',null,12000,'par événement','677000010','MTN MoMo','Cheffe cuisinière spécialisée dans la cuisine camerounaise et internationale.','carine@skillconnect.cm','CE','#FEF9E7','#7D6608',4.9,23,'mm','Autres',1,'available',null,null],
  ];
  for (const u of users) {
    await pool.execute(
      `INSERT INTO users (id,prenom,nom,ville,skill,skill_custom,tarif,tarif_unit,phone,mm_network,bio,email,initials,bg_color,text_color,rating,reviews,badge,cat,validated,availability,photo,password_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      u
    );
  }
  await pool.query('ALTER TABLE users AUTO_INCREMENT = 11');

  const messages = [
    [1,2,1,"Bonjour ! J'ai vu votre profil sur SkillConnect. Est-ce que vous êtes disponible pour un cours de maths ce samedi ?",1,'2026-06-05 10:32:00'],
    [2,1,2,"Bonjour ! Oui, je suis disponible samedi. Quel niveau et quelle durée souhaitez-vous ?",1,'2026-06-05 10:35:00'],
    [3,2,1,"Mon fils est en terminale C. On aurait besoin d'environ 2h de cours sur les intégrales.",1,'2026-06-05 10:38:00'],
    [4,1,2,"Parfait ! Ça sera 10 000 FCFA pour 2h. Vous pouvez payer via MTN MoMo directement sur la plateforme.",1,'2026-06-05 10:40:00'],
    [5,2,1,"D'accord, c'est bon pour moi. Je vais réserver tout de suite via SkillConnect.",1,'2026-06-05 10:42:00'],
    [6,4,1,"Bonjour Amina, j'ai besoin d'un prof de maths pour ma petite sœur. Vous êtes disponible en semaine ?",0,'2026-06-05 14:20:00'],
    [7,1,4,"Oui, je suis disponible du lundi au vendredi de 16h à 19h. Quel niveau est-elle ?",0,'2026-06-05 14:25:00'],
    [8,5,1,"Salut ! Est-ce que tu fais aussi des cours de physique-chimie ?",0,'2026-06-05 15:05:00'],
  ];
  for (const m of messages) {
    await pool.execute('INSERT INTO messages (id,sender_id,receiver_id,text,`read`,sent_at) VALUES (?,?,?,?,?,?)', m);
  }
  await pool.query('ALTER TABLE messages AUTO_INCREMENT = 9');

  const missions = [
    [1,2,1,'Cours de maths (2h)',10000,'completed'],
    [2,3,1,"Cours d'algèbre (1h)",5000,'completed'],
    [3,4,1,'BAC blanc maths',15000,'completed'],
    [4,5,1,'Cours statistiques (1h)',5000,'completed'],
    [5,6,1,'Préparation examen (3h)',15000,'completed'],
    [6,7,1,'Cours de maths (1h)',5000,'in_progress'],
    [7,8,1,'Session révisions BAC',10000,'pending'],
  ];
  for (const m of missions) {
    await pool.execute('INSERT INTO missions (id,client_id,talent_id,title,amount,status) VALUES (?,?,?,?,?,?)', m);
  }
  await pool.query('ALTER TABLE missions AUTO_INCREMENT = 8');

  const transactions = [
    [1,2,1,10000,700,9300,'Cours de maths (2h)','MTN MoMo',null,'payment','completed',null,'2026-06-01 10:00:00',null],
    [2,3,1,5000,350,4650,"Cours d'algèbre (1h)",'Orange Money',null,'payment','completed',null,'2026-06-02 14:00:00',null],
    [3,4,1,15000,1050,13950,'BAC blanc maths (3h)','MTN MoMo',null,'payment','escrow',null,'2026-06-04 09:00:00',null],
    [4,5,1,5000,350,4650,'Cours statistiques (1h)','Orange Money',null,'payment','completed',null,'2026-06-03 16:00:00',null],
    [5,6,1,15000,1050,13950,'Préparation examen (3h)','MTN MoMo',null,'payment','completed',null,'2026-05-28 10:00:00',null],
    [6,1,2,15000,1050,13950,'Logo entreprise','MTN MoMo',null,'payment','completed',null,'2026-05-20 09:00:00',null],
    [7,1,4,25000,1750,23250,'Site vitrine (5 pages)','MTN MoMo',null,'payment','escrow',null,'2026-06-03 11:00:00',null],
  ];
  for (const t of transactions) {
    await pool.execute(
      'INSERT INTO transactions (id,sender_id,receiver_id,amount,commission,net_amount,description,network,phone,type,status,campay_reference,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      t
    );
  }
  await pool.query('ALTER TABLE transactions AUTO_INCREMENT = 8');

  const reviews_data = [
    [1,1,2,'Kevin N.','KN','#EEEDFE','#3C3489',5,"Amina est une excellente prof ! Très patiente et pédagogue. Mon fils a eu 14/20 à son examen.",1,'2026-06-01 12:00:00'],
    [2,1,3,'Sandrine F.','SF','#FAEEDA','#633806',5,"Cours très bien expliqués, ma fille progresse vite. Je recommande vivement !",2,'2026-06-02 16:30:00'],
    [3,1,5,'Fatima C.','FC','#C8EFE3','#085041',4,"Très compétente et disponible. Le seul bémol est la ponctualité mais les cours sont top.",4,'2026-06-03 18:00:00'],
  ];
  for (const r of reviews_data) {
    await pool.execute(
      'INSERT INTO reviews (id,talent_id,reviewer_id,reviewer_name,reviewer_initials,reviewer_bg,reviewer_col,rating,comment,transaction_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      r
    );
  }
  await pool.query('ALTER TABLE reviews AUTO_INCREMENT = 4');

  const notifications_data = [
    [1,1,'payment','Vous avez reçu 9 300 FCFA de Kevin N. pour "Cours de maths (2h)"',1,'2026-06-01 10:05:00'],
    [2,1,'review','Kevin N. vous a laissé un avis 5 étoiles ⭐',1,'2026-06-01 12:00:00'],
    [3,1,'message','Nouveau message de Eric Biya',0,'2026-06-05 14:20:00'],
    [4,1,'message','Nouveau message de Fatima Coulibaly',0,'2026-06-05 15:05:00'],
  ];
  for (const n of notifications_data) {
    await pool.execute('INSERT INTO notifications (id,user_id,type,message,`read`,created_at) VALUES (?,?,?,?,?,?)', n);
  }
  await pool.query('ALTER TABLE notifications AUTO_INCREMENT = 5');

  console.log('✅ Données de démo insérées dans MySQL');
}

// ─── Talents ──────────────────────────────────────────────────────────────────
async function getTalents({ cat, q, ville, tarif_min, tarif_max, availability, sort, page, limit } = {}) {
  let where = 'WHERE validated = 1';
  const params = [];

  if (cat && cat !== 'Tous') {
    if (cat === 'Autres') {
      where += ` AND cat NOT IN (${MAIN_CATS.map(() => '?').join(',')})`;
      params.push(...MAIN_CATS);
    } else {
      where += ' AND cat = ?';
      params.push(cat);
    }
  }
  if (q) {
    where += ' AND (prenom LIKE ? OR nom LIKE ? OR skill LIKE ? OR ville LIKE ?)';
    const lq = `%${q}%`;
    params.push(lq, lq, lq, lq);
  }
  if (ville)        { where += ' AND ville = ?';        params.push(ville); }
  if (tarif_min)    { where += ' AND tarif >= ?';       params.push(parseInt(tarif_min)); }
  if (tarif_max)    { where += ' AND tarif <= ?';       params.push(parseInt(tarif_max)); }
  if (availability) { where += ' AND availability = ?'; params.push(availability); }

  let order = ' ORDER BY rating DESC, reviews DESC';
  if (sort === 'price_asc')  order = ' ORDER BY tarif ASC';
  else if (sort === 'price_desc') order = ' ORDER BY tarif DESC';
  else if (sort === 'newest')     order = ' ORDER BY created_at DESC';

  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) as total FROM users ${where}`, params);

  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const limitNum = Math.min(50, parseInt(limit) || 9);
  const offset   = (pageNum - 1) * limitNum;

  const [rows] = await pool.execute(
    `SELECT * FROM users ${where}${order} LIMIT ${limitNum} OFFSET ${offset}`,
    params
  );
  return { talents: rows, total, page: pageNum, limit: limitNum };
}

async function getVilles() {
  const [rows] = await pool.execute('SELECT DISTINCT ville FROM users WHERE validated = 1 ORDER BY ville');
  return rows.map(r => r.ville);
}

async function getTalentById(id) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

async function createUser(body) {
  const { prenom, nom, ville, skill, skill_custom, skills, tarif, tarif_unit, phone, mm_network, bio, email, password_hash, photo } = body;
  const skillName = skill === 'Autres' ? (skill_custom || 'Autre compétence') : skill;
  const cat = mapSkillToCat(skillName);
  const initials = ((prenom || ' ')[0] + (nom || ' ')[0]).toUpperCase();
  const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM users');
  const color = COLORS[cnt % COLORS.length];
  // Stocker le JSON des skills (ou construire depuis skillName si non fourni)
  const skillsJson = skills || JSON.stringify([skillName].filter(Boolean));

  const [result] = await pool.execute(
    `INSERT INTO users (prenom,nom,ville,skill,skill_custom,skills,tarif,tarif_unit,phone,mm_network,bio,email,initials,bg_color,text_color,rating,reviews,badge,cat,validated,availability,photo,password_hash,email_verified,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,5.0,0,'new',?,1,'available',?,?,0,?)`,
    [prenom||null, nom||null, ville||null, skillName, skill_custom||null, skillsJson,
     parseInt(tarif)||0, tarif_unit||'par heure',
     phone||null, mm_network||'MTN MoMo', bio||'', email||'', initials, color.bg, color.col,
     cat, photo||null, password_hash||null, fmtISO()]
  );

  return {
    id: result.insertId,
    prenom, nom, ville,
    skill: skillName, skills: skillsJson, cat,
    initials, bg_color: color.bg, text_color: color.col,
    email: email || '', phone,
  };
}

async function updateUser(id, body) {
  const { prenom, nom, skill, skills, ville, cat, bio, tarif, tarif_unit, availability, photo, mm_network, phone, password_hash } = body;
  const sets = [];
  const params = [];
  if (prenom       !== undefined) { sets.push('prenom = ?');       params.push(prenom); }
  if (nom          !== undefined) { sets.push('nom = ?');          params.push(nom); }
  if (skill        !== undefined) { sets.push('skill = ?');        params.push(skill); }
  if (skills       !== undefined) { sets.push('skills = ?');       params.push(skills); }
  if (ville        !== undefined) { sets.push('ville = ?');        params.push(ville); }
  if (cat          !== undefined) { sets.push('cat = ?');          params.push(cat); }
  if (bio          !== undefined) { sets.push('bio = ?');          params.push(bio); }
  if (tarif        !== undefined) { sets.push('tarif = ?');        params.push(parseInt(tarif)||0); }
  if (tarif_unit   !== undefined) { sets.push('tarif_unit = ?');   params.push(tarif_unit); }
  if (availability !== undefined) { sets.push('availability = ?'); params.push(availability); }
  if (photo        !== undefined) { sets.push('photo = ?');        params.push(photo); }
  if (mm_network   !== undefined) { sets.push('mm_network = ?');   params.push(mm_network); }
  if (phone         !== undefined) { sets.push('phone = ?');         params.push(phone); }
  if (password_hash !== undefined) { sets.push('password_hash = ?'); params.push(password_hash); }
  if (sets.length === 0) return;
  // Recalculer les initiales si prénom/nom changé
  if (prenom !== undefined || nom !== undefined) {
    const [rows] = await pool.execute('SELECT prenom, nom FROM users WHERE id = ?', [id]);
    const cur = rows[0] || {};
    const p = (prenom !== undefined ? prenom : cur.prenom) || '?';
    const n = (nom    !== undefined ? nom    : cur.nom)    || '?';
    sets.push('initials = ?');
    params.push((p[0] + n[0]).toUpperCase());
  }
  params.push(id);
  await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function findUserByEmail(email) {
  if (!email) return null;
  const [rows] = await pool.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  return rows[0] || null;
}

async function deleteUser(userId) {
  const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [parseInt(userId)]);
  return result.affectedRows > 0;
}

async function findOrCreateGoogleUser({ email, prenom, nom, photo }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    const updates = [];
    const params = [];
    if (!existing.email_verified) { updates.push('email_verified = 1'); }
    if (!existing.photo && photo) { updates.push('photo = ?'); params.push(photo); }
    if (updates.length) {
      params.push(existing.id);
      await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    return { ...existing, email_verified: 1, photo: existing.photo || photo || null, isNew: false };
  }

  const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM users');
  const color    = COLORS[cnt % COLORS.length];
  const initials = ((prenom || '?')[0] + (nom || '?')[0]).toUpperCase();

  const [result] = await pool.execute(
    `INSERT INTO users (prenom,nom,ville,skill,skill_custom,tarif,tarif_unit,phone,mm_network,bio,email,initials,bg_color,text_color,rating,reviews,badge,cat,validated,availability,photo,password_hash,email_verified,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,5.0,0,'new',?,1,'available',?,?,1,?)`,
    [prenom||null, nom||null, null, null, null, 0, 'par heure',
     null, 'MTN MoMo', '', email||'', initials, color.bg, color.col,
     'Autres', photo||null, null, fmtISO()]
  );

  return {
    id: result.insertId,
    prenom: prenom||null, nom: nom||null, email,
    skill: null, initials, bg_color: color.bg, text_color: color.col,
    photo: photo||null, email_verified: 1, isNew: true,
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function getDashboardData(userId) {
  const user = await getTalentById(userId);
  if (!user) return null;

  const [missions] = await pool.execute('SELECT * FROM missions WHERE talent_id = ?', [userId]);
  const completed = missions.filter(m => m.status === 'completed');
  const revenue = completed.reduce((s, m) => s + m.amount, 0);

  const [[{ unread }]] = await pool.execute(
    'SELECT COUNT(*) as unread FROM messages WHERE receiver_id = ? AND `read` = 0',
    [userId]
  );

  const skillMap = {};
  missions.forEach(m => { skillMap[m.title] = (skillMap[m.title] || 0) + 1; });
  const skillStats = Object.entries(skillMap)
    .map(([title, cnt]) => ({ title, cnt }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 5);

  const [[{ unreadNotifs }]] = await pool.execute(
    'SELECT COUNT(*) as unreadNotifs FROM notifications WHERE user_id = ? AND `read` = 0',
    [userId]
  );

  const views = await getProfileViews(userId, 30);
  const { password_hash: _ph, ...safeUser } = user;
  safeUser.has_password = !!_ph;
  return {
    user: safeUser,
    revenue: Math.round(revenue * 0.93),
    missions: completed.length,
    pending: missions.filter(m => m.status === 'pending').length,
    rating: user.rating,
    views,
    unread,
    unreadNotifs,
    skillStats,
  };
}

// ─── Messagerie ────────────────────────────────────────────────────────────────
async function getContacts(userId) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id
     FROM messages WHERE sender_id = ? OR receiver_id = ?`,
    [userId, userId, userId]
  );

  const contacts = [];
  for (const row of rows) {
    const otherId = row.other_id;
    if (otherId === userId) continue;

    const other = await getTalentById(otherId);
    if (!other) continue;

    const [lastRows] = await pool.execute(
      `SELECT sender_id, text, file_type, sent_at FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY sent_at DESC LIMIT 1`,
      [userId, otherId, otherId, userId]
    );

    const [[{ unread }]] = await pool.execute(
      'SELECT COUNT(*) as unread FROM messages WHERE sender_id = ? AND receiver_id = ? AND `read` = 0',
      [otherId, userId]
    );

    const last = lastRows[0];
    contacts.push({
      id: other.id, prenom: other.prenom, nom: other.nom,
      initials: other.initials, bg_color: other.bg_color, text_color: other.text_color,
      photo: other.photo || null, skill: other.skill, ville: other.ville,
      availability: other.availability || 'available',
      last_seen: other.last_seen || null,
      last_message:   last?.file_type ? (last.file_type.startsWith('image/') ? '📷 Photo' : '📎 Fichier') : (last?.text || ''),
      last_sender_id: last?.sender_id || null,
      last_time:      last?.sent_at   || null,
      unread,
    });
  }

  return contacts.sort((a, b) => new Date(b.last_time || 0) - new Date(a.last_time || 0));
}

async function getMessages(userId, contactId) {
  const [rows] = await pool.execute(
    `SELECT m.*,
            u.initials AS sender_initials, u.bg_color AS sender_bg,
            u.text_color AS sender_col, u.prenom AS sender_prenom,
            u.nom AS sender_nom, u.photo AS sender_photo,
            r.text AS reply_text, r.file_type AS reply_file_type,
            ru.prenom AS reply_prenom, ru.id AS reply_sender_id
     FROM messages m
     LEFT JOIN users u  ON u.id = m.sender_id
     LEFT JOIN messages r  ON r.id = m.reply_to_id
     LEFT JOIN users ru ON ru.id = r.sender_id
     WHERE (m.sender_id = ? AND m.receiver_id = ?)
        OR (m.sender_id = ? AND m.receiver_id = ?)
     ORDER BY m.sent_at ASC`,
    [userId, contactId, contactId, userId]
  );
  // Attach reactions to each message
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const [reacts] = await pool.execute(
      `SELECT mr.message_id, mr.emoji, mr.user_id FROM message_reactions mr WHERE mr.message_id IN (${ids.map(()=>'?').join(',')})`,
      ids
    );
    const reactMap = {};
    for (const r of reacts) {
      if (!reactMap[r.message_id]) reactMap[r.message_id] = [];
      reactMap[r.message_id].push({ emoji: r.emoji, user_id: r.user_id });
    }
    for (const row of rows) row.reactions = reactMap[row.id] || [];
  }
  return rows;
}

async function sendMessage(senderId, receiverId, text, fileData = null, fileName = null, fileType = null, replyToId = null) {
  const now = fmtISO();
  const [result] = await pool.execute(
    'INSERT INTO messages (sender_id,receiver_id,text,`read`,sent_at,file_data,file_name,file_type,reply_to_id) VALUES (?,?,?,0,?,?,?,?,?)',
    [senderId, receiverId, text || '', now, fileData || null, fileName || null, fileType || null, replyToId || null]
  );
  let reply_text = null, reply_prenom = null, reply_sender_id = null, reply_file_type = null;
  if (replyToId) {
    const [[replied]] = await pool.execute(
      'SELECT m.text, m.file_type, u.prenom, u.id AS sender_id FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.id=?',
      [replyToId]
    );
    if (replied) { reply_text = replied.text; reply_prenom = replied.prenom; reply_sender_id = replied.sender_id; reply_file_type = replied.file_type; }
  }
  return { id: result.insertId, sender_id: senderId, receiver_id: receiverId, text: text || '', read: 0, sent_at: now, file_data: fileData, file_name: fileName, file_type: fileType, reply_to_id: replyToId, reply_text, reply_prenom, reply_sender_id, reply_file_type, reactions: [] };
}

async function toggleReaction(messageId, userId, emoji) {
  const [[existing]] = await pool.execute(
    'SELECT id, emoji FROM message_reactions WHERE message_id=? AND user_id=?',
    [messageId, userId]
  );
  if (existing) {
    if (existing.emoji === emoji) {
      await pool.execute('DELETE FROM message_reactions WHERE message_id=? AND user_id=?', [messageId, userId]);
      return { action: 'removed', emoji };
    }
    await pool.execute('UPDATE message_reactions SET emoji=? WHERE message_id=? AND user_id=?', [emoji, messageId, userId]);
    return { action: 'changed', emoji };
  }
  await pool.execute('INSERT INTO message_reactions (message_id,user_id,emoji) VALUES (?,?,?)', [messageId, userId, emoji]);
  return { action: 'added', emoji };
}

async function updateLastSeen(userId) {
  await pool.execute('UPDATE users SET last_seen=? WHERE id=?', [fmtISO(), userId]);
}

async function markAsRead(userId, contactId) {
  await pool.execute(
    'UPDATE messages SET `read` = 1 WHERE sender_id = ? AND receiver_id = ?',
    [contactId, userId]
  );
}

// ─── Reviews ──────────────────────────────────────────────────────────────────
async function createReview(body) {
  const { talentId, reviewerId, rating, comment, transactionId } = body;
  const reviewer = await getTalentById(parseInt(reviewerId));
  const now = fmtISO();

  const [result] = await pool.execute(
    `INSERT INTO reviews (talent_id,reviewer_id,reviewer_name,reviewer_initials,reviewer_bg,reviewer_col,rating,comment,transaction_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      parseInt(talentId), parseInt(reviewerId),
      reviewer ? `${reviewer.prenom} ${reviewer.nom[0]}.` : 'Anonyme',
      reviewer ? reviewer.initials : '?',
      reviewer ? reviewer.bg_color : '#ccc',
      reviewer ? reviewer.text_color : '#000',
      parseInt(rating), comment || '',
      parseInt(transactionId) || null, now,
    ]
  );

  const [[{ avg, cnt }]] = await pool.execute(
    'SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE talent_id = ?',
    [parseInt(talentId)]
  );
  await pool.execute('UPDATE users SET rating = ?, reviews = ? WHERE id = ?', [
    Math.round(avg * 10) / 10, cnt, parseInt(talentId),
  ]);

  if (reviewer) {
    await createNotification({
      userId: parseInt(talentId),
      type: 'review',
      message: `${reviewer.prenom} ${reviewer.nom[0]}. vous a laissé un avis ${rating} étoile${rating > 1 ? 's' : ''} ⭐`,
    });
  }

  return {
    id: result.insertId, talent_id: parseInt(talentId), reviewer_id: parseInt(reviewerId),
    reviewer_name: reviewer ? `${reviewer.prenom} ${reviewer.nom[0]}.` : 'Anonyme',
    reviewer_initials: reviewer ? reviewer.initials : '?',
    reviewer_bg: reviewer ? reviewer.bg_color : '#ccc',
    reviewer_col: reviewer ? reviewer.text_color : '#000',
    rating: parseInt(rating), comment: comment || '',
    transaction_id: parseInt(transactionId) || null, created_at: now,
  };
}

async function getReviews(talentId) {
  const [rows] = await pool.execute(
    'SELECT * FROM reviews WHERE talent_id = ? ORDER BY created_at DESC',
    [parseInt(talentId)]
  );
  return rows;
}

async function replyToReview(reviewId, talentId, reply) {
  const [rows] = await pool.execute('SELECT * FROM reviews WHERE id = ?', [parseInt(reviewId)]);
  const review = rows[0];
  if (!review) throw new Error('Avis non trouvé');
  if (review.talent_id !== parseInt(talentId)) throw new Error('Non autorisé');
  await pool.execute(
    'UPDATE reviews SET reply = ?, reply_at = ? WHERE id = ?',
    [reply, fmtISO(), parseInt(reviewId)]
  );
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function createNotification({ userId, type, message }) {
  const now = fmtISO();
  const [result] = await pool.execute(
    'INSERT INTO notifications (user_id,type,message,`read`,created_at) VALUES (?,?,?,0,?)',
    [parseInt(userId), type, message, now]
  );
  return { id: result.insertId, user_id: parseInt(userId), type, message, read: 0, created_at: now };
}

async function getNotifications(userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [parseInt(userId)]
  );
  return rows;
}

async function markNotificationRead(notifId) {
  await pool.execute('UPDATE notifications SET `read` = 1 WHERE id = ?', [parseInt(notifId)]);
}

async function markAllNotificationsRead(userId) {
  await pool.execute('UPDATE notifications SET `read` = 1 WHERE user_id = ?', [parseInt(userId)]);
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function createTransaction(body) {
  const { senderId, receiverId, amount, description, network, campay_reference } = body;
  const amt = parseInt(amount);
  const commission = Math.round(amt * 0.07);
  const net_amount = amt - commission;
  const now = fmtISO();

  const [result] = await pool.execute(
    `INSERT INTO transactions (sender_id,receiver_id,amount,commission,net_amount,description,network,type,status,campay_reference,created_at)
     VALUES (?,?,?,?,?,?,?,'payment','escrow',?,?)`,
    [parseInt(senderId), parseInt(receiverId), amt, commission, net_amount,
     description||'', network||'MTN MoMo', campay_reference||null, now]
  );

  const sender   = await getTalentById(parseInt(senderId));
  const receiver = await getTalentById(parseInt(receiverId));
  if (sender && receiver) {
    await createNotification({
      userId: parseInt(receiverId),
      type: 'payment',
      message: `${sender.prenom} ${sender.nom[0]}. vous a envoyé ${net_amount.toLocaleString('fr-FR')} FCFA pour "${description}"`,
    });
  }

  return {
    id: result.insertId,
    sender_id: parseInt(senderId), receiver_id: parseInt(receiverId),
    amount: amt, commission, net_amount,
    description: description||'', network: network||'MTN MoMo',
    type: 'payment', status: 'escrow',
    campay_reference: campay_reference||null, created_at: now,
  };
}

async function getWallet(userId) {
  const uid = parseInt(userId);
  const [txs] = await pool.execute(
    'SELECT * FROM transactions WHERE sender_id = ? OR receiver_id = ?',
    [uid, uid]
  );
  const earned      = txs.filter(t => t.receiver_id === uid && t.status === 'completed');
  const escrow      = txs.filter(t => t.receiver_id === uid && t.status === 'escrow');
  const spent       = txs.filter(t => t.sender_id   === uid && t.status !== 'cancelled');
  const withdrawals = txs.filter(t => t.sender_id   === uid && t.type === 'withdrawal');
  const totalEarned    = earned.reduce((s, t) => s + (t.net_amount || t.amount - t.commission), 0);
  const totalWithdrawn = withdrawals.reduce((s, t) => s + t.amount, 0);
  return {
    available:   totalEarned - totalWithdrawn,
    inEscrow:    escrow.reduce((s, t) => s + (t.net_amount || t.amount - t.commission), 0),
    totalEarned,
    totalSpent:  spent.reduce((s, t) => s + t.amount, 0),
  };
}

async function getTransactions(userId) {
  const uid = parseInt(userId);
  const [rows] = await pool.execute(
    'SELECT * FROM transactions WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC',
    [uid, uid]
  );
  return rows;
}

async function updateTransactionStatus(id, status) {
  if (status === 'completed') {
    await pool.execute('UPDATE transactions SET status = ?, completed_at = ? WHERE id = ?',
      [status, fmtISO(), parseInt(id)]);
  } else {
    await pool.execute('UPDATE transactions SET status = ? WHERE id = ?', [status, parseInt(id)]);
  }
  const [rows] = await pool.execute('SELECT * FROM transactions WHERE id = ?', [parseInt(id)]);
  return rows[0] || null;
}

async function createWithdrawal({ userId, amount, network, phone }) {
  const uid = parseInt(userId);
  const amt = parseInt(amount);
  const wallet = await getWallet(uid);
  if (wallet.available < amt) throw new Error('Solde insuffisant');

  const now = fmtISO();
  const [result] = await pool.execute(
    `INSERT INTO transactions (sender_id,receiver_id,amount,commission,net_amount,description,network,phone,type,status,created_at)
     VALUES (?,0,?,0,?,?,?,?,'withdrawal','pending',?)`,
    [uid, amt, amt, `Retrait vers ${network||'Mobile Money'}`, network||'MTN MoMo', phone||'', now]
  );

  return {
    id: result.insertId, sender_id: uid, receiver_id: 0,
    amount: amt, commission: 0, net_amount: amt,
    description: `Retrait vers ${network||'Mobile Money'}`,
    network: network||'MTN MoMo', phone: phone||'',
    type: 'withdrawal', status: 'pending', created_at: now,
  };
}

async function createDeposit({ userId, amount, network, phone, campay_reference }) {
  const uid = parseInt(userId);
  const amt = parseInt(amount);
  const status = campay_reference ? 'pending' : 'completed';
  const now = fmtISO();

  const [result] = await pool.execute(
    `INSERT INTO transactions (sender_id,receiver_id,amount,commission,net_amount,description,network,phone,type,status,campay_reference,created_at)
     VALUES (0,?,?,0,?,?,?,?,'deposit',?,?,?)`,
    [uid, amt, amt, `Dépôt depuis ${network||'Mobile Money'}`, network||'MTN MoMo', phone||'',
     status, campay_reference||null, now]
  );

  return {
    id: result.insertId, sender_id: 0, receiver_id: uid,
    amount: amt, commission: 0, net_amount: amt,
    description: `Dépôt depuis ${network||'Mobile Money'}`,
    network: network||'MTN MoMo', phone: phone||'',
    type: 'deposit', status, campay_reference: campay_reference||null, created_at: now,
  };
}

async function findTransactionByCampayRef(reference) {
  const [rows] = await pool.execute(
    'SELECT * FROM transactions WHERE campay_reference = ?',
    [reference]
  );
  return rows[0] || null;
}

// ─── Portfolio ────────────────────────────────────────────────────────────────
async function getPortfolio(talentId) {
  const [rows] = await pool.execute(
    'SELECT * FROM portfolio WHERE talent_id = ? ORDER BY created_at DESC',
    [parseInt(talentId)]
  );
  return rows;
}

async function createPortfolioItem({ talentId, title, description, image }) {
  const [result] = await pool.execute(
    'INSERT INTO portfolio (talent_id, title, description, image, created_at) VALUES (?, ?, ?, ?, ?)',
    [parseInt(talentId), title || '', description || '', image || null, fmtISO()]
  );
  return { id: result.insertId, talent_id: parseInt(talentId), title, description, image, created_at: fmtISO() };
}

async function deletePortfolioItem(id, talentId) {
  const [result] = await pool.execute(
    'DELETE FROM portfolio WHERE id = ? AND talent_id = ?',
    [parseInt(id), parseInt(talentId)]
  );
  return result.affectedRows > 0;
}

// ─── Mot de passe oublié ──────────────────────────────────────────────────────
async function createResetToken(userId, token, expiresAt) {
  await pool.execute(
    'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [parseInt(userId), token, expiresAt]
  );
}

async function findResetToken(token) {
  const [rows] = await pool.execute(
    'SELECT * FROM reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
    [token]
  );
  return rows[0] || null;
}

async function markResetTokenUsed(token) {
  await pool.execute('UPDATE reset_tokens SET used = 1 WHERE token = ?', [token]);
}

async function updatePassword(userId, passwordHash) {
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, parseInt(userId)]);
}

// ─── Vérification email ───────────────────────────────────────────────────────
async function createVerifyToken(userId, token) {
  await pool.execute(
    'REPLACE INTO email_verify_tokens (user_id, token, created_at) VALUES (?, ?, ?)',
    [parseInt(userId), token, fmtISO()]
  );
}

async function findVerifyToken(token) {
  const [rows] = await pool.execute(
    'SELECT * FROM email_verify_tokens WHERE token = ?',
    [token]
  );
  return rows[0] || null;
}

async function markEmailVerified(userId) {
  await pool.execute('UPDATE users SET email_verified = 1 WHERE id = ?', [parseInt(userId)]);
  await pool.execute('DELETE FROM email_verify_tokens WHERE user_id = ?', [parseInt(userId)]);
}

// ─── Litiges ─────────────────────────────────────────────────────────────────
async function createDispute({ transactionId, talentId, clientId, reason }) {
  const now = fmtISO();
  const [result] = await pool.execute(
    'INSERT INTO disputes (transaction_id,talent_id,client_id,reason,status,created_at) VALUES (?,?,?,?,"open",?)',
    [parseInt(transactionId), parseInt(talentId), parseInt(clientId), reason||'', now]
  );
  return { id: result.insertId, transaction_id: parseInt(transactionId), talent_id: parseInt(talentId), client_id: parseInt(clientId), reason: reason||'', status: 'open', created_at: now };
}

async function getDisputeByTxId(transactionId) {
  const [rows] = await pool.execute('SELECT * FROM disputes WHERE transaction_id = ?', [parseInt(transactionId)]);
  return rows[0] || null;
}

async function getAllDisputes() {
  const [rows] = await pool.execute('SELECT * FROM disputes ORDER BY created_at DESC');
  return rows;
}

async function resolveDispute(id, adminNote, resolution) {
  await pool.execute(
    'UPDATE disputes SET status = ?, admin_note = ?, resolved_at = ? WHERE id = ?',
    [resolution || 'resolved', adminNote || '', fmtISO(), parseInt(id)]
  );
}

// ─── Signalements ─────────────────────────────────────────────────────────────
async function createReport({ reporterId, reportedId, reason, description }) {
  const now = fmtISO();
  const [result] = await pool.execute(
    'INSERT INTO reports (reporter_id,reported_id,reason,description,status,created_at) VALUES (?,?,?,?,"pending",?)',
    [parseInt(reporterId), parseInt(reportedId), reason||'', description||'', now]
  );
  return { id: result.insertId, reporter_id: parseInt(reporterId), reported_id: parseInt(reportedId), reason: reason||'', description: description||'', status: 'pending', created_at: now };
}

async function getAllReports() {
  const [rows] = await pool.execute(`
    SELECT r.*,
      u1.prenom AS reporter_prenom, u1.nom AS reporter_nom,
      u2.prenom AS reported_prenom, u2.nom AS reported_nom
    FROM reports r
    LEFT JOIN users u1 ON u1.id = r.reporter_id
    LEFT JOIN users u2 ON u2.id = r.reported_id
    ORDER BY r.created_at DESC
  `);
  return rows;
}

async function updateReportStatus(reportId, status, adminNote) {
  await pool.execute(
    'UPDATE reports SET status=?, admin_note=? WHERE id=?',
    [status, adminNote||null, parseInt(reportId)]
  );
}

// ─── Bannissements ────────────────────────────────────────────────────────────
async function banUser(userId, banType, banUntil, reason, adminNote) {
  await pool.execute(
    `INSERT INTO bans (user_id,ban_type,ban_until,reason,admin_note,created_at)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE ban_type=VALUES(ban_type),ban_until=VALUES(ban_until),reason=VALUES(reason),admin_note=VALUES(admin_note),created_at=VALUES(created_at)`,
    [parseInt(userId), banType||'temp', banUntil||null, reason||'', adminNote||'', fmtISO()]
  );
}

async function unbanUser(userId) {
  await pool.execute('DELETE FROM bans WHERE user_id=?', [parseInt(userId)]);
}

async function getUserBan(userId) {
  const [rows] = await pool.execute('SELECT * FROM bans WHERE user_id=?', [parseInt(userId)]);
  if (!rows.length) return null;
  const ban = rows[0];
  if (ban.ban_type === 'temp' && ban.ban_until && new Date(ban.ban_until) < new Date()) {
    await unbanUser(userId);
    return null;
  }
  return ban;
}

async function getAllBans() {
  const [rows] = await pool.execute(`
    SELECT b.*, u.prenom, u.nom, u.email FROM bans b
    LEFT JOIN users u ON u.id = b.user_id
    ORDER BY b.created_at DESC
  `);
  return rows;
}

// ─── Offres de missions ───────────────────────────────────────────────────────
async function createJobPost({ clientId, title, description, budget, budgetType, budget_type, category, ville, deadline_days }) {
  const now = fmtISO();
  const bt = budgetType || budget_type || 'fixe';
  const dl = parseInt(deadline_days) || null;
  const [result] = await pool.execute(
    `INSERT INTO job_posts (client_id,title,description,budget,budget_type,category,ville,deadline_days,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,'open',?)`,
    [parseInt(clientId), title||'', description||'', parseInt(budget)||0,
     bt, category||'Autres', ville||null, dl, now]
  );
  return { id: result.insertId, client_id: parseInt(clientId), title, description, budget: parseInt(budget)||0, budget_type: bt, category: category||'Autres', ville: ville||null, deadline_days: dl, status: 'open', created_at: now };
}

async function getJobs({ cat, category, q, ville, status = 'open', budget, page, limit } = {}) {
  let where = "WHERE j.status = ?";
  const params = [status];
  const c = cat || category;
  if (c && c !== 'Tous') { where += ' AND j.category = ?'; params.push(c); }
  if (q)     { where += ' AND (j.title LIKE ? OR j.description LIKE ?)'; const lq = `%${q}%`; params.push(lq, lq); }
  if (ville) { where += ' AND j.ville = ?'; params.push(ville); }
  if (budget === 'low')  { where += ' AND j.budget < 50000'; }
  if (budget === 'mid')  { where += ' AND j.budget >= 50000 AND j.budget <= 200000'; }
  if (budget === 'high') { where += ' AND j.budget > 200000'; }

  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) as total FROM job_posts j ${where}`, params);
  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const limitNum = Math.min(50, parseInt(limit) || 9);
  const offset   = (pageNum - 1) * limitNum;

  const [rows] = await pool.execute(
    `SELECT j.*, u.prenom, u.nom, u.initials, u.bg_color, u.text_color,
            (SELECT COUNT(*) FROM job_applications a WHERE a.job_id = j.id) as applicants
     FROM job_posts j LEFT JOIN users u ON u.id = j.client_id
     ${where} ORDER BY j.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
    params
  );
  return { jobs: rows, total, page: pageNum, limit: limitNum };
}

async function getJobById(id) {
  const [rows] = await pool.execute(
    `SELECT j.*, u.prenom, u.nom, u.initials, u.bg_color, u.text_color
     FROM job_posts j LEFT JOIN users u ON u.id = j.client_id WHERE j.id = ?`,
    [parseInt(id)]
  );
  return rows[0] || null;
}

async function applyToJob({ jobId, talentId, message }) {
  const now = fmtISO();
  const [result] = await pool.execute(
    'INSERT INTO job_applications (job_id,talent_id,message,status,created_at) VALUES (?,?,?,\'pending\',?)',
    [parseInt(jobId), parseInt(talentId), message||'', now]
  );
  return { id: result.insertId, job_id: parseInt(jobId), talent_id: parseInt(talentId), message: message||'', status: 'pending', created_at: now };
}

async function getJobApplications(jobId) {
  const [rows] = await pool.execute(
    `SELECT a.*, u.prenom, u.nom, COALESCE(CONCAT(u.prenom,' ',u.nom),'Utilisateur supprimé') as talent_name,
            u.initials, u.bg_color, u.text_color, u.skill, u.rating, u.reviews
     FROM job_applications a LEFT JOIN users u ON u.id = a.talent_id
     WHERE a.job_id = ? ORDER BY a.created_at DESC`,
    [parseInt(jobId)]
  );
  return rows;
}

async function getMyJobPosts(clientId) {
  const [rows] = await pool.execute(
    `SELECT j.*, (SELECT COUNT(*) FROM job_applications a WHERE a.job_id = j.id) as applicants
     FROM job_posts j WHERE j.client_id = ? ORDER BY j.created_at DESC`,
    [parseInt(clientId)]
  );
  return rows;
}

async function getMyApplications(talentId) {
  const [rows] = await pool.execute(
    `SELECT a.*, j.title, j.budget, j.budget_type, j.category, j.ville, j.status as job_status,
            u.prenom as client_prenom, u.nom as client_nom
     FROM job_applications a
     LEFT JOIN job_posts j ON j.id = a.job_id
     LEFT JOIN users u ON u.id = j.client_id
     WHERE a.talent_id = ? ORDER BY a.created_at DESC`,
    [parseInt(talentId)]
  );
  return rows;
}

async function closeJobPost(id, clientId) {
  await pool.execute(
    "UPDATE job_posts SET status = 'closed' WHERE id = ? AND client_id = ?",
    [parseInt(id), parseInt(clientId)]
  );
}

async function updateApplicationStatus(appId, status) {
  await pool.execute(
    'UPDATE job_applications SET status = ? WHERE id = ?',
    [status, parseInt(appId)]
  );
}

async function getTalentActiveCount(talentId) {
  const [[{ cnt }]] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM transactions WHERE receiver_id = ? AND status IN ('escrow','delivered')",
    [parseInt(talentId)]
  );
  return cnt;
}

// ─── Missions Groupées ───────────────────────────────────────────────────────
async function createGroupedMission({ clientId, titre, description }) {
  const [r] = await pool.execute(
    'INSERT INTO grouped_missions (client_id,titre,description,statut,created_at) VALUES (?,?,?,?,?)',
    [parseInt(clientId), titre, description || '', 'active', fmtISO()]
  );
  return { id: r.insertId, client_id: parseInt(clientId), titre, description, statut: 'active' };
}

async function addTalentToGroupedMission({ missionId, talentId, role, montant }) {
  const [r] = await pool.execute(
    'INSERT INTO grouped_mission_talents (mission_id,talent_id,role,montant,statut_paiement,created_at) VALUES (?,?,?,?,?,?)',
    [parseInt(missionId), parseInt(talentId), role || '', parseInt(montant) || 0, 'pending', fmtISO()]
  );
  return { id: r.insertId, mission_id: parseInt(missionId), talent_id: parseInt(talentId), role, montant };
}

async function updateGroupedMissionTalentTx(id, txId, statut) {
  await pool.execute('UPDATE grouped_mission_talents SET tx_id=?, statut_paiement=? WHERE id=?', [txId, statut, id]);
}

async function getGroupedMission(id) {
  const [[gm]] = await pool.execute('SELECT gm.*, u.prenom, u.nom FROM grouped_missions gm LEFT JOIN users u ON u.id=gm.client_id WHERE gm.id=?', [parseInt(id)]);
  if (!gm) return null;
  const [talents] = await pool.execute(
    `SELECT gmt.*, u.prenom, u.nom, u.skill, u.tarif, u.initials, u.bg_color, u.text_color, u.photo
     FROM grouped_mission_talents gmt
     LEFT JOIN users u ON u.id = gmt.talent_id
     WHERE gmt.mission_id = ?`,
    [parseInt(id)]
  );
  return { ...gm, talents };
}

async function getGroupedMissionsForClient(clientId) {
  const [rows] = await pool.execute(
    'SELECT * FROM grouped_missions WHERE client_id=? ORDER BY created_at DESC',
    [parseInt(clientId)]
  );
  return rows;
}

// ─── Carte des talents ────────────────────────────────────────────────────────
const CITY_COORDS = {
  'Yaoundé':   { lat: 3.848,  lng: 11.502 },
  'Douala':    { lat: 4.051,  lng: 9.767  },
  'Bafoussam': { lat: 5.478,  lng: 10.417 },
  'Buea':      { lat: 4.155,  lng: 9.241  },
  'Garoua':    { lat: 9.301,  lng: 13.397 },
  'Ngaoundéré':{ lat: 7.330,  lng: 13.583 },
  'Bamenda':   { lat: 5.951,  lng: 10.166 },
  'Maroua':    { lat: 10.591, lng: 14.315 },
  'Kribi':     { lat: 2.940,  lng: 9.906  },
  'Limbe':     { lat: 4.019,  lng: 9.195  },
};

async function getTalentsForCarte({ competence, budgetMax, ville } = {}) {
  let where = "WHERE t.availability = 'available' AND t.validated = 1";
  const params = [];
  if (competence) { where += ' AND (t.skill LIKE ? OR t.skill_custom LIKE ?)'; params.push('%'+competence+'%','%'+competence+'%'); }
  if (budgetMax)  { where += ' AND t.tarif <= ?'; params.push(parseInt(budgetMax)); }
  if (ville)      { where += ' AND t.ville = ?'; params.push(ville); }

  const [rows] = await pool.execute(
    `SELECT t.id, t.prenom, t.nom, t.skill, t.skill_custom, t.tarif, t.tarif_unit,
            t.ville, t.rating, t.reviews, t.initials, t.bg_color, t.text_color, t.photo, t.availability
     FROM users t ${where} ORDER BY t.rating DESC`,
    params
  );

  return rows.map(t => ({
    ...t,
    coords: CITY_COORDS[t.ville] || null,
  })).filter(t => t.coords);
}

// ─── Détail transaction pour rapport PDF ─────────────────────────────────────
async function getTransactionDetail(txId, userId) {
  const [[tx]] = await pool.execute(
    `SELECT tx.*,
       s.prenom AS sender_prenom, s.nom AS sender_nom, s.email AS sender_email, s.phone AS sender_phone,
       r.prenom AS receiver_prenom, r.nom AS receiver_nom, r.email AS receiver_email, r.phone AS receiver_phone,
       r.skill, r.skill_custom
     FROM transactions tx
     LEFT JOIN users s ON s.id = tx.sender_id
     LEFT JOIN users r ON r.id = tx.receiver_id
     WHERE tx.id = ? AND (tx.sender_id = ? OR tx.receiver_id = ?)`,
    [parseInt(txId), parseInt(userId), parseInt(userId)]
  );
  return tx || null;
}

// ─── Blocage d'utilisateurs ──────────────────────────────────────────────────
async function blockUser(blockerId, blockedId) {
  try {
    await pool.execute('INSERT INTO blocked_users (blocker_id,blocked_id) VALUES (?,?)', [parseInt(blockerId), parseInt(blockedId)]);
  } catch(e) {} // ignore duplicate
}

async function unblockUser(blockerId, blockedId) {
  await pool.execute('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', [parseInt(blockerId), parseInt(blockedId)]);
}

async function isBlocked(blockerId, blockedId) {
  const [[{ cnt }]] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
    [parseInt(blockerId), parseInt(blockedId)]
  );
  return cnt > 0;
}

async function getBlockedIds(userId) {
  const [rows] = await pool.execute('SELECT blocked_id FROM blocked_users WHERE blocker_id = ?', [parseInt(userId)]);
  return rows.map(r => r.blocked_id);
}

// ─── Suppression de conversation ──────────────────────────────────────────────
async function deleteConversation(userId, contactId) {
  const u = parseInt(userId), c = parseInt(contactId);
  await pool.execute(
    'DELETE FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
    [u, c, c, u]
  );
}

// ─── Vues de profil ──────────────────────────────────────────────────────────
async function recordProfileView(talentId, viewerId) {
  const tid = parseInt(talentId);
  const vid = viewerId ? parseInt(viewerId) : null;
  if (vid === tid) return; // pas de comptage auto-visite
  try {
    await pool.execute('INSERT INTO profile_views (talent_id, viewer_id, viewed_at) VALUES (?,?,NOW())', [tid, vid]);
  } catch(e) {}
}

async function getProfileViews(talentId, days = 30) {
  const [[{ cnt }]] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM profile_views WHERE talent_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)',
    [parseInt(talentId), days]
  );
  return cnt;
}

// ─── Push subscriptions ───────────────────────────────────────────────────────
async function savePushSubscription(userId, subscription) {
  const { endpoint, keys: { p256dh, auth } } = subscription;
  await pool.execute(
    'INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE p256dh=VALUES(p256dh),auth=VALUES(auth)',
    [parseInt(userId), endpoint, p256dh, auth]
  );
}

async function deletePushSubscription(userId, endpoint) {
  await pool.execute('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [parseInt(userId), endpoint]);
}

async function getUserPushSubscriptions(userId) {
  const [rows] = await pool.execute('SELECT * FROM push_subscriptions WHERE user_id = ?', [parseInt(userId)]);
  return rows;
}

// ─── Stats publiques ─────────────────────────────────────────────────────────
async function getSiteStats() {
  const [[{ users }]]    = await pool.execute('SELECT COUNT(*) as users FROM users WHERE validated = 1');
  const [[{ missions }]] = await pool.execute("SELECT COUNT(*) as missions FROM transactions WHERE status = 'completed'");
  const [[{ villes }]]   = await pool.execute("SELECT COUNT(DISTINCT ville) as villes FROM users WHERE ville IS NOT NULL AND ville != ''");
  return { users, missions, villes };
}

// ─── Admin ────────────────────────────────────────────────────────────────────
async function getAdminStats() {
  const [[{ totalUsers }]]   = await pool.execute('SELECT COUNT(*) as totalUsers FROM users');
  const [[{ totalTx }]]      = await pool.execute('SELECT COUNT(*) as totalTx FROM transactions WHERE status = "completed"');
  const [[{ totalVolume }]]  = await pool.execute('SELECT COALESCE(SUM(amount),0) as totalVolume FROM transactions WHERE status = "completed"');
  const [[{ totalCommission }]] = await pool.execute('SELECT COALESCE(SUM(commission),0) as totalCommission FROM transactions WHERE status = "completed"');
  const [[{ newUsers }]]     = await pool.execute('SELECT COUNT(*) as newUsers FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)');
  return { totalUsers, totalTx, totalVolume, totalCommission, newUsers };
}

async function getAllUsers() {
  const [rows] = await pool.execute(
    'SELECT id,prenom,nom,email,ville,skill,cat,rating,reviews,badge,validated,availability,created_at FROM users ORDER BY created_at DESC'
  );
  return rows;
}

async function toggleUserValidation(userId) {
  await pool.execute('UPDATE users SET validated = 1 - validated WHERE id = ?', [parseInt(userId)]);
  const user = await getTalentById(parseInt(userId));
  return user;
}

async function getAllTransactions() {
  const [rows] = await pool.execute(
    'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200'
  );
  return rows;
}

module.exports = {
  init,
  getTalents, getTalentById, createUser, updateUser, findUserByEmail, deleteUser,
  getDashboardData, getVilles,
  getContacts, getMessages, sendMessage, markAsRead, toggleReaction, updateLastSeen,
  createTransaction, getWallet, getTransactions, updateTransactionStatus,
  createWithdrawal, createDeposit, findTransactionByCampayRef,
  createReview, getReviews,
  createNotification, getNotifications, markNotificationRead, markAllNotificationsRead,
  getPortfolio, createPortfolioItem, deletePortfolioItem,
  createResetToken, findResetToken, markResetTokenUsed, updatePassword,
  createGroupedMission, addTalentToGroupedMission, updateGroupedMissionTalentTx,
  getGroupedMission, getGroupedMissionsForClient,
  getTalentsForCarte, getTransactionDetail,
  blockUser, unblockUser, isBlocked, getBlockedIds,
  deleteConversation,
  recordProfileView, getProfileViews,
  savePushSubscription, deletePushSubscription, getUserPushSubscriptions,
  getSiteStats,
  getAdminStats, getAllUsers, toggleUserValidation, getAllTransactions,
  createDispute, getDisputeByTxId, getAllDisputes, resolveDispute,
  createReport, getAllReports, updateReportStatus,
  banUser, unbanUser, getUserBan, getAllBans,
  createVerifyToken, findVerifyToken, markEmailVerified,
  replyToReview,
  createJobPost, getJobs, getJobById, applyToJob, getJobApplications,
  getMyJobPosts, getMyApplications, closeJobPost, updateApplicationStatus, getTalentActiveCount,
  findOrCreateGoogleUser,
};
