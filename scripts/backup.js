#!/usr/bin/env node
/**
 * Script de backup de la base de données SkillConnect
 * Usage : node scripts/backup.js
 *         npm run backup
 *
 * Crée un fichier SQL horodaté dans backups/
 * Gardez les 7 derniers backups automatiquement.
 */

require('dotenv').config();
const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');

const BACKUP_DIR    = path.join(__dirname, '..', 'backups');
const KEEP_BACKUPS  = 7;

const {
  DB_HOST     = 'localhost',
  DB_PORT     = '3306',
  DB_USER     = 'root',
  DB_PASSWORD = '',
  DB_NAME     = 'SkillConnect',
} = process.env;

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const now      = new Date();
const stamp    = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const filename = `backup_${DB_NAME}_${stamp}.sql`;
const filepath = path.join(BACKUP_DIR, filename);

const cmd = `mysqldump --host=${DB_HOST} --port=${DB_PORT} --user=${DB_USER} --password=${DB_PASSWORD} --single-transaction --routines --triggers ${DB_NAME}`;

console.log(`🗄️  Backup de ${DB_NAME}…`);

const out  = fs.createWriteStream(filepath);
const proc = exec(cmd, { maxBuffer: 200 * 1024 * 1024 });

proc.stdout.pipe(out);

proc.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  // mysqldump écrit un avertissement de mot de passe sur stderr, on l'ignore
  if (!msg.includes('Warning: Using a password')) console.error('⚠️ ', msg);
});

proc.on('close', (code) => {
  if (code !== 0) {
    console.error(`❌ Backup échoué (code ${code})`);
    try { fs.unlinkSync(filepath); } catch(_) {}
    process.exit(1);
  }

  const size = (fs.statSync(filepath).size / 1024).toFixed(1);
  console.log(`✅ Backup créé : backups/${filename} (${size} Ko)`);

  // Rotation : garder seulement les N derniers backups
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.sql'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  files.slice(KEEP_BACKUPS).forEach(f => {
    fs.unlinkSync(path.join(BACKUP_DIR, f.name));
    console.log(`🗑️  Ancien backup supprimé : ${f.name}`);
  });
});
