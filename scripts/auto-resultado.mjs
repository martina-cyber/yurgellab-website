/* ====================================================================
   Bolão Yurgel Lab — automação de datas e placares dos jogos do Brasil.

   Rodado pelo GitHub Action (cron). Faz duas coisas, sem intervenção humana:

   1) FASE DE GRUPOS (datas fixas em bolao-fixtures.json): busca o placar
      do Brasil na data e, se o jogo terminou, grava em resultados/<id>.

   2) MATA-MATA (datas ainda não definidas): varre a janela das fases
      finais no scoreboard da ESPN, coleta os jogos do Brasil em ORDEM
      CRONOLÓGICA e mapeia por posição (1º jogo do mata-mata = 16-avos,
      2º = oitavas, ...). Grava em resultados/_datas/<id> a data/horário/
      adversário descobertos (traduzindo placeholders como "Group F 2nd
      Place" -> "2º do Grupo F") e, quando termina, o placar em resultados/<id>.
      (As datas ficam sob resultados/ porque as regras do Firebase só liberam
      escrita em palpites/ e resultados/.)

   A página lê resultados/_datas/<id> e resultados/<id> e atualiza em tempo real.
   Registro manual e resultado já existente têm prioridade (não sobrescreve).
   ==================================================================== */
import { readFile } from "node:fs/promises";

const DB   = "https://bolao-yurgel-default-rtdb.firebaseio.com";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=";

/* Janela do mata-mata da Copa 2026 (começa depois do último jogo de grupo
   do Brasil, em 24/06). Varrida dia a dia. */
const KO_INICIO = "2026-06-28";
const KO_FIM    = "2026-07-19";

/* Ordem das fases do mata-mata -> id do jogo no bolão (por posição cronológica). */
const KO_IDS = ["bra-16avos", "bra-oitavas", "bra-quartas", "bra-semi", "bra-final"];

/* Bandeiras por seleção (fallback ❔ quando desconhecida/placeholder). */
const FLAGS = {
  "argentina":"🇦🇷","australia":"🇦🇺","austria":"🇦🇹","belgium":"🇧🇪","bolivia":"🇧🇴",
  "bosnia-herzegovina":"🇧🇦","brazil":"🇧🇷","cameroon":"🇨🇲","canada":"🇨🇦","chile":"🇨🇱",
  "colombia":"🇨🇴","costa rica":"🇨🇷","croatia":"🇭🇷","czechia":"🇨🇿","denmark":"🇩🇰",
  "ecuador":"🇪🇨","egypt":"🇪🇬","england":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","france":"🇫🇷","germany":"🇩🇪","ghana":"🇬🇭",
  "haiti":"🇭🇹","iran":"🇮🇷","italy":"🇮🇹","ivory coast":"🇨🇮","jamaica":"🇯🇲","japan":"🇯🇵",
  "mexico":"🇲🇽","morocco":"🇲🇦","netherlands":"🇳🇱","new zealand":"🇳🇿","nigeria":"🇳🇬",
  "norway":"🇳🇴","panama":"🇵🇦","paraguay":"🇵🇾","peru":"🇵🇪","poland":"🇵🇱","portugal":"🇵🇹",
  "qatar":"🇶🇦","saudi arabia":"🇸🇦","scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","senegal":"🇸🇳","serbia":"🇷🇸",
  "south africa":"🇿🇦","south korea":"🇰🇷","spain":"🇪🇸","sweden":"🇸🇪","switzerland":"🇨🇭",
  "tunisia":"🇹🇳","türkiye":"🇹🇷","turkey":"🇹🇷","united states":"🇺🇸","uruguay":"🇺🇾","wales":"🏴󠁧󠁢󠁷󠁬󠁥󠁳󠁿",
};

const ddmmyyyyToEspn = (d) => {
  const m = String(d || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + m[2] + m[1] : null;
};
const isBrasil = (t) =>
  /brazil|brasil|\bBRA\b/i.test((t?.displayName || "") + " " + (t?.abbreviation || "") + " " + (t?.name || ""));
const flagDe = (nome) => FLAGS[String(nome || "").trim().toLowerCase()] || "❔";

/* Traduz nomes-placeholder da ESPN para português; nome real de seleção passa direto. */
function nomeAdversario(nome) {
  const s = String(nome || "").trim();
  let m;
  if ((m = s.match(/group\s+([a-l])\s+2nd/i)))            return `2º do Grupo ${m[1].toUpperCase()}`;
  if ((m = s.match(/group\s+([a-l]).*(1st|winner)/i)))    return `1º do Grupo ${m[1].toUpperCase()}`;
  if ((m = s.match(/(1st|winner).*group\s+([a-l])/i)))    return `1º do Grupo ${m[2].toUpperCase()}`;
  if ((m = s.match(/winner\s+(?:match\s+)?(\d+)/i)))       return `Vencedor do Jogo ${m[1]}`;
  if ((m = s.match(/(?:loser|runner)\D*(\d+)/i)))          return `Perdedor do Jogo ${m[1]}`;
  return s;
}

/* ISO (UTC) -> { data:"dd/mm/yyyy", horario:"19h30 (Brasília)" } em horário de Brasília (UTC-3). */
function brasilia(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return null;
  const b = new Date(t.getTime() - 3 * 3600000);
  const dd = String(b.getUTCDate()).padStart(2, "0");
  const mm = String(b.getUTCMonth() + 1).padStart(2, "0");
  const hh = b.getUTCHours();
  const min = b.getUTCMinutes();
  return { data: `${dd}/${mm}/${b.getUTCFullYear()}`, horario: `${hh}h${min ? String(min).padStart(2, "0") : ""} (Brasília)` };
}

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function jput(path, valor) {
  const r = await fetch(`${DB}/${path}.json`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valor),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

function jogoDoBrasil(data) {
  for (const ev of (data.events || [])) {
    const comp = (ev.competitions || [])[0];
    const cs = comp ? (comp.competitors || []) : [];
    const bra = cs.find((c) => isBrasil(c.team));
    const adv = cs.find((c) => c !== bra);
    if (bra && adv) return { ev, comp, bra, adv };
  }
  return null;
}
const terminou = (ev) => ev?.status?.type?.completed === true || ev?.status?.type?.state === "post";

async function gravaResultado(id, bra, adv, ev, log) {
  const atual = await jget(`${DB}/resultados/${id}.json`).catch(() => null);
  if (atual && atual.h != null && atual.a != null) {
    log(`· ${id}: já tem resultado (${atual.h}x${atual.a}) — mantido`);
    return 0;
  }
  if (!terminou(ev)) { log(`· ${id}: Brasil x ${adv.team.displayName} ainda não terminou — aguarda`); return 0; }
  const h = Number(bra.score), a = Number(adv.score);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return 0;
  const valor = { h, a };
  // Empate no mata-mata: registra o placar dos pênaltis (define o vencedor na página).
  if (h === a) {
    const ph = Number(bra.shootoutScore), pa = Number(adv.shootoutScore);
    if (Number.isFinite(ph) && Number.isFinite(pa) && ph !== pa) { valor.ph = ph; valor.pa = pa; }
  }
  await jput(`resultados/${id}`, valor);
  const penTxt = valor.ph != null ? ` (pênaltis ${valor.ph} x ${valor.pa})` : "";
  log(`✓ ${id}: placar gravado — Brasil ${h} x ${a} ${adv.team.displayName}${penTxt}`);
  return 1;
}

async function main() {
  let gravados = 0, datasNovas = 0;
  const log = (m) => console.log(m);

  /* ---------- 1) Fase de grupos (datas fixas) ---------- */
  const fixtures = JSON.parse(await readFile(new URL("../bolao-fixtures.json", import.meta.url), "utf8"));
  for (const fx of fixtures) {
    const dia = ddmmyyyyToEspn(fx.date);
    if (!dia) continue;                         // sem data fixa -> tratado no mata-mata
    let data;
    try { data = await jget(ESPN + dia); } catch { log(`! ${fx.id}: ESPN indisponível`); continue; }
    const j = jogoDoBrasil(data);
    if (!j) { log(`· ${fx.id}: jogo do Brasil não encontrado nessa data`); continue; }
    gravados += await gravaResultado(fx.id, j.bra, j.adv, j.ev, log);
  }

  /* ---------- 2) Mata-mata (descoberta por ordem cronológica) ---------- */
  const ini = new Date(KO_INICIO + "T12:00Z"), fim = new Date(KO_FIM + "T12:00Z");
  const jogosKO = [];
  const datasVistas = new Set();
  for (let t = new Date(ini); t <= fim; t = new Date(t.getTime() + 86400000)) {
    const dia = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
    let data;
    try { data = await jget(ESPN + dia); } catch { continue; }
    const j = jogoDoBrasil(data);
    if (!j) continue;
    const chave = String(j.ev.date).slice(0, 10);
    if (datasVistas.has(chave)) continue;       // um jogo do Brasil por dia
    datasVistas.add(chave);
    jogosKO.push({ iso: j.ev.date, ...j });
  }
  jogosKO.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));

  for (let i = 0; i < jogosKO.length && i < KO_IDS.length; i++) {
    const id = KO_IDS[i];
    const j = jogosKO[i];
    const quando = brasilia(j.iso) || {};
    const advReal = j.adv.team.displayName;
    const meta = { data: quando.data, horario: quando.horario, fora: nomeAdversario(advReal), flagFora: flagDe(advReal) };
    const atualMeta = await jget(`${DB}/resultados/_datas/${id}.json`).catch(() => null);
    const igual = atualMeta && atualMeta.data === meta.data && atualMeta.horario === meta.horario
      && atualMeta.fora === meta.fora && atualMeta.flagFora === meta.flagFora;
    if (!igual) {
      await jput(`resultados/_datas/${id}`, meta);
      log(`✓ ${id}: ${meta.data} ${meta.horario} vs ${meta.fora}`);
      datasNovas++;
    } else {
      log(`· ${id}: já registrado (${meta.data} vs ${meta.fora})`);
    }
    gravados += await gravaResultado(id, j.bra, j.adv, j.ev, log);
  }

  console.log(`\nResumo: ${datasNovas} data(s) definida(s), ${gravados} resultado(s) gravado(s).`);
}

main().catch((e) => { console.error("Erro:", e); process.exit(1); });
