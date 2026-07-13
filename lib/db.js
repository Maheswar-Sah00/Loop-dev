import Database from 'better-sqlite3';

/**
 * Local SQLite storage layer for offers and needs.
 *
 * JSON arrays (skills / need_skills) are stored as TEXT via JSON.stringify and
 * parsed back into arrays on read, so callers always work with real arrays.
 */

const DB_PATH = './loop.db';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS offers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT,
    channel_id        TEXT,
    message_ts        TEXT,
    skills            TEXT,
    availability_text TEXT,
    location          TEXT,
    language          TEXT,
    raw_excerpt       TEXT,
    created_ts        INTEGER,
    status            TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS needs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id     TEXT,
    channel_id       TEXT,
    message_ts       TEXT,
    need_skills      TEXT,
    timing           TEXT,
    location         TEXT,
    language         TEXT,
    raw_text              TEXT,
    status                TEXT NOT NULL DEFAULT 'open',
    matched_offer_id      INTEGER,
    matched_offer_user_id TEXT
  );
`);

// Migration for databases created before matched_offer_user_id existed.
const needsColumns = db.prepare(`PRAGMA table_info(needs)`).all();
if (!needsColumns.some((/** @type {any} */ c) => c.name === 'matched_offer_user_id')) {
  db.exec(`ALTER TABLE needs ADD COLUMN matched_offer_user_id TEXT`);
}

console.log(`[db] SQLite initialized at ${DB_PATH}`);

/**
 * @typedef {Object} OfferInput
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} message_ts
 * @property {string[]} skills
 * @property {string} [availability_text]
 * @property {string} [location]
 * @property {string} [language]
 * @property {string} [raw_excerpt]
 * @property {number} created_ts        Unix timestamp (seconds).
 * @property {string} [status]          Defaults to 'active'.
 */

/**
 * @typedef {Object} Offer
 * @property {number} id
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} message_ts
 * @property {string[]} skills
 * @property {string | null} availability_text
 * @property {string | null} location
 * @property {string | null} language
 * @property {string | null} raw_excerpt
 * @property {number} created_ts
 * @property {string} status
 */

/**
 * @typedef {Object} NeedInput
 * @property {string} requester_id
 * @property {string} channel_id
 * @property {string} message_ts
 * @property {string[]} need_skills
 * @property {string} [timing]
 * @property {string} [location]
 * @property {string} [language]
 * @property {string} [raw_text]
 * @property {string} [status]           Defaults to 'open'.
 * @property {number | null} [matched_offer_id]
 */

/**
 * @typedef {Object} Need
 * @property {number} id
 * @property {string} requester_id
 * @property {string} channel_id
 * @property {string} message_ts
 * @property {string[]} need_skills
 * @property {string | null} timing
 * @property {string | null} location
 * @property {string | null} language
 * @property {string | null} raw_text
 * @property {string} status
 * @property {number | null} matched_offer_id
 * @property {string | null} matched_offer_user_id
 */

// --- Prepared statements -----------------------------------------------------

const insertOfferStmt = db.prepare(`
  INSERT INTO offers
    (user_id, channel_id, message_ts, skills, availability_text, location, language, raw_excerpt, created_ts, status)
  VALUES
    (@user_id, @channel_id, @message_ts, @skills, @availability_text, @location, @language, @raw_excerpt, @created_ts, @status)
`);

const listActiveOffersStmt = db.prepare(`SELECT * FROM offers WHERE status = 'active' ORDER BY created_ts DESC`);
const recentOffersStmt = db.prepare(`SELECT * FROM offers WHERE status = 'active' ORDER BY created_ts DESC LIMIT ?`);
const countActiveOffersStmt = db.prepare(`SELECT COUNT(*) AS c FROM offers WHERE status = 'active'`);
const getOfferStmt = db.prepare(`SELECT * FROM offers WHERE id = ?`);

const insertNeedStmt = db.prepare(`
  INSERT INTO needs
    (requester_id, channel_id, message_ts, need_skills, timing, location, language, raw_text, status, matched_offer_id)
  VALUES
    (@requester_id, @channel_id, @message_ts, @need_skills, @timing, @location, @language, @raw_text, @status, @matched_offer_id)
`);

const getNeedStmt = db.prepare(`SELECT * FROM needs WHERE id = ?`);
const listOpenNeedsStmt = db.prepare(`SELECT * FROM needs WHERE status = 'open' ORDER BY id DESC`);
const listOpenOrAwaitingNeedsStmt = db.prepare(
  `SELECT * FROM needs WHERE status IN ('open', 'awaiting_consent') ORDER BY id DESC`,
);
const listMatchedNeedsStmt = db.prepare(`SELECT * FROM needs WHERE status = 'matched' ORDER BY id DESC LIMIT ?`);
const updateNeedStatusStmt = db.prepare(`UPDATE needs SET status = @status, matched_offer_id = @matched_offer_id WHERE id = @id`);
const setNeedMatchUserStmt = db.prepare(
  `UPDATE needs SET status = @status, matched_offer_user_id = @matched_offer_user_id WHERE id = @id`,
);

// --- Row mappers -------------------------------------------------------------

/**
 * @param {any} row
 * @returns {Offer | undefined}
 */
function mapOffer(row) {
  if (!row) return undefined;
  return { ...row, skills: parseJsonArray(row.skills) };
}

/**
 * @param {any} row
 * @returns {Need | undefined}
 */
function mapNeed(row) {
  if (!row) return undefined;
  return { ...row, need_skills: parseJsonArray(row.need_skills) };
}

/**
 * @param {string | null} text
 * @returns {string[]}
 */
function parseJsonArray(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// --- Public helpers ----------------------------------------------------------

/**
 * Insert a new offer.
 * @param {OfferInput} obj
 * @returns {Offer} The stored offer, including its generated id.
 */
export function addOffer(obj) {
  const info = insertOfferStmt.run({
    user_id: obj.user_id,
    channel_id: obj.channel_id,
    message_ts: obj.message_ts,
    skills: JSON.stringify(obj.skills ?? []),
    availability_text: obj.availability_text ?? null,
    location: obj.location ?? null,
    language: obj.language ?? null,
    raw_excerpt: obj.raw_excerpt ?? null,
    created_ts: obj.created_ts,
    status: obj.status ?? 'active',
  });
  return /** @type {Offer} */ (getOffer(Number(info.lastInsertRowid)));
}

/**
 * List every offer whose status is 'active', newest first.
 * @returns {Offer[]}
 */
export function listActiveOffers() {
  return listActiveOffersStmt.all().map((r) => /** @type {Offer} */ (mapOffer(r)));
}

/**
 * The most recent active offers, newest first.
 * @param {number} [limit]
 * @returns {Offer[]}
 */
export function recentOffers(limit = 3) {
  return recentOffersStmt.all(limit).map((r) => /** @type {Offer} */ (mapOffer(r)));
}

/**
 * Count of active offers on file.
 * @returns {number}
 */
export function countActiveOffers() {
  return /** @type {{ c: number }} */ (countActiveOffersStmt.get()).c;
}

/**
 * Fetch a single offer by id.
 * @param {number} id
 * @returns {Offer | undefined}
 */
export function getOffer(id) {
  return mapOffer(getOfferStmt.get(id));
}

/**
 * Insert a new need.
 * @param {NeedInput} obj
 * @returns {Need} The stored need, including its generated id.
 */
export function addNeed(obj) {
  const info = insertNeedStmt.run({
    requester_id: obj.requester_id,
    channel_id: obj.channel_id,
    message_ts: obj.message_ts,
    need_skills: JSON.stringify(obj.need_skills ?? []),
    timing: obj.timing ?? null,
    location: obj.location ?? null,
    language: obj.language ?? null,
    raw_text: obj.raw_text ?? null,
    status: obj.status ?? 'open',
    matched_offer_id: obj.matched_offer_id ?? null,
  });
  return /** @type {Need} */ (getNeed(Number(info.lastInsertRowid)));
}

/**
 * Fetch a single need by id.
 * @param {number} id
 * @returns {Need | undefined}
 */
export function getNeed(id) {
  return mapNeed(getNeedStmt.get(id));
}

/**
 * Update a need's status and (optionally) the offer it was matched to.
 * @param {number} id
 * @param {string} status
 * @param {number | null} [matchedOfferId]
 * @returns {Need | undefined} The updated need.
 */
export function updateNeedStatus(id, status, matchedOfferId = null) {
  updateNeedStatusStmt.run({ id, status, matched_offer_id: matchedOfferId });
  return getNeed(id);
}

/**
 * Update a need's status and the matched volunteer's user id (the consent-flow
 * state machine: 'awaiting_consent' → 'matched', or back to 'open' on decline).
 * @param {number} id
 * @param {string} status
 * @param {string | null} [matchedOfferUserId]
 * @returns {Need | undefined} The updated need.
 */
export function setNeedMatchUser(id, status, matchedOfferUserId = null) {
  setNeedMatchUserStmt.run({ id, status, matched_offer_user_id: matchedOfferUserId });
  return getNeed(id);
}

/**
 * List every need whose status is 'open', newest first.
 * @returns {Need[]}
 */
export function listOpenNeeds() {
  return listOpenNeedsStmt.all().map((r) => /** @type {Need} */ (mapNeed(r)));
}

/**
 * List needs still in flight ('open' or 'awaiting_consent'), newest first.
 * @returns {Need[]}
 */
export function listOpenOrAwaitingNeeds() {
  return listOpenOrAwaitingNeedsStmt.all().map((r) => /** @type {Need} */ (mapNeed(r)));
}

/**
 * List the most recently matched needs, newest first.
 * @param {number} [limit]
 * @returns {Need[]}
 */
export function listMatchedNeeds(limit = 5) {
  return listMatchedNeedsStmt.all(limit).map((r) => /** @type {Need} */ (mapNeed(r)));
}

export { db };
