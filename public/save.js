export const saveKey = 'nexus.namek.v1';
const previousKey = saveKey + '.anterior';

class UnreadableCampaign extends Error {}

export function isUnreadableCampaign(error) { return error instanceof UnreadableCampaign; }

function parseCampaign(raw) {
  const s = JSON.parse(raw);
  if (s?.version !== 1 || !Number.isFinite(s.clock) || !Number.isFinite(s.created) ||
      !Number.isFinite(s.nextAt) || !Number.isFinite(s.gold) || !s.positions ||
      !Array.isArray(s.team) || !Array.isArray(s.collection) || !s.collection.length ||
      !Array.isArray(s.log)) throw Error('Dados da campanha inválidos.');
  return s;
}

export function readCampaign(storage) {
  const raw = storage.getItem(saveKey);
  if (raw !== null) {
    // A newer format belongs to a newer build. Preserve it until that build opens it.
    let version;
    try { version = JSON.parse(raw)?.version; } catch {}
    if (typeof version === 'number' && version > 1) throw new UnreadableCampaign('Este progresso exige uma versão mais recente do jogo.');
    try { return parseCampaign(raw); } catch {}
  }
  const previous = storage.getItem(previousKey);
  if (previous !== null) {
    try { return parseCampaign(previous); } catch { throw new UnreadableCampaign('O save local está danificado. Importe um backup para restaurá-lo.'); }
  }
  if (raw !== null) throw new UnreadableCampaign('O save local está danificado. Importe um backup para restaurá-lo.');
  return null;
}

export function writeCampaign(storage, state) {
  const next = JSON.stringify(state);
  const current = storage.getItem(saveKey);
  if (current === next) return;
  // Keep the last readable checkpoint. Its failure must not block the main save.
  if (current !== null) {
    try { parseCampaign(current); storage.setItem(previousKey, current); } catch {}
  }
  try { storage.setItem(saveKey, next); }
  catch (error) {
    if (error.name !== 'QuotaExceededError' || !current || !storage.getItem(previousKey)) throw error;
    // Remove the extra checkpoint only when the primary is itself readable.
    parseCampaign(current);
    storage.removeItem(previousKey);
    storage.setItem(saveKey, next);
  }
}

export function packCampaign(state) {
  return JSON.stringify({game:'nexus-namek', format:1, campaign:state});
}

export function unpackCampaign(text, characters, worlds) {
  const file = JSON.parse(text, (key, value) => {
    if (['__proto__','prototype','constructor'].includes(key) ||
        typeof value === 'string' && /[<>"&]/.test(value)) throw Error('Conteúdo inválido no backup.');
    return value;
  });
  if (file?.game !== 'nexus-namek' || file.format !== 1) throw Error('Escolha um backup de campanha do Alca RNG.');
  const s = parseCampaign(JSON.stringify(file.campaign));
  const validUnit = u => u && Object.hasOwn(characters, u.id) && typeof u.uid==='string' &&
    /^[\w-]+$/.test(u.uid) && Number.isFinite(u.xp) && u.xp>=0 &&
    (u.shiny===undefined||typeof u.shiny==='boolean') &&
    (u.serial===undefined||Number.isSafeInteger(u.serial)&&u.serial>=0) &&
    (u.odds==null||Number.isFinite(u.odds)&&u.odds>=0);
  const validPosition = point => Array.isArray(point) && point.length===2 &&
    point.every(value=>Number.isFinite(value)&&value>=0&&value<=100);
  const validPositions = typeof s.positions==='object' && !Array.isArray(s.positions) &&
    Object.values(s.positions).every(validPosition);
  const validSprite = unit => unit && typeof unit.sprite==='string' && /^[a-z0-9-]+$/i.test(unit.sprite);
  const ids = new Set(s.collection.map(u => u?.uid));
  const world = worlds[s.world ?? 0];
  if (!world?.areas[s.area] || !validPositions || !s.collection.every(validUnit) || ids.size !== s.collection.length ||
      s.team.length > 4 || !s.team.every(uid => ids.has(uid)) || (s.leader && !ids.has(s.leader)) ||
      (s.pending && (!Array.isArray(s.pending.result?.events) || !Array.isArray(s.pending.team) ||
        !s.pending.team.every(validSprite) || !validSprite(s.pending.enemy) || !Number.isFinite(s.pending.end)))) throw Error('Campanha incompleta ou incompatível.');
  return s;
}
