/* ====================================================================
   Bolão Yurgel Lab — automação de datas e placares dos jogos do Brasil.

   Rodado pelo GitHub Action (cron). Faz duas coisas, sem intervenção humana:

   1) FASE DE GRUPOS (datas fixas em bolao-fixtures.json): busca o placar
      do Brasil na data e, se o jogo terminou, grava em resultados/<id>.

   2) MATA-MATA (datas ainda não definidas): varre a janela das fases
      finais no scoreboard da ESPN, acha o jogo do Brasil, lê a FASE
      (Round of 32, Quarterfinals, ...) e mapeia para o id do bolão.
      Grava em datas/<id> a data/horário/adversário descobertos e, quando
      o jogo termina, o placar em resultados/<id>.

   A página lê datas/<id> e resultados/<id> e atualiza tudo em tempo real.
   Registro manual e resultado já existente têm prioridade (não sobrescreve).
   ==================================================================== */
import { readFile } from "node:fs/promises";

const DB   = "https://bolao-yurgel-default-rtdb.firebaseio.com";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=";

/* Janela do mata-mata da Copa 2026 (varrida dia a dia). */
const KO_INICIO = "2026-06-27";
const KO_FIM    = "2026-07-19";

/* Fase (season.type.name na ESPN) -> id do jogo no bolão. Ordem importa:
   "Semifinals" contém "final", então semi é testado antes de final. */
const FASE_PARA_ID = [
  [/round of 32/i,              "bra-16avos"],
  [/round of 16|last 16/i,      "bra-oitavas"],
  [/quarter/i,                  "bra-quartas"],
  [/semi/i,                     "bra-semi"],
  [/3rd place|third place/i,    "bra-final"],
  [/final/i,                    "bra-final"],
];

/* Bandeiras por seleção (fallback ❔ quando desconhecida). */
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
  "tunisia":"🇹🇳","türkiye":"🇹🇷","turkey":"🇹🇷","united states":"🇺🇸","uruguay":"🇺🇾","wales":"🏴󠁧󠁢󠁷󠁬󠁳󠁿",
};

const ddmmyyyyToEspn = (d) => {
  const m = String(d || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + m[2] + m[1] : null;
};
const isBrasil = (t) =>
  /brazil|brasil|\bBRA\b/i.test((t?.displayName || "") + " " + (t?.abbreviation || "") + " " + (t?.name || ""));
const flagDe = (nome) => FLAGS[String(nome || "").trim().toLowerCase()] || "❔";

/* ISO (UTC) -> { data:"dd/mm/yyyy", horario:"19h30 (Brasília)" } em horário de Brasília (UTC-3). */
function brasilia(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return null;
  const b = new Date(t.getTime() - 3 * 3600000);
  const dd = String(b.getUTCDate()).padStart(2, "0");
  const mm = String(b.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = b.getUTCFullYear();
  const hh = b.getUTCHours();
  const min = b.getUTCMinutes();
  const horario = `${hh}h${min ? String(min).padStart(2, "0") : ""} (Brasília)`;
  return { data: `${dd}/${mm}/${yyyy}`, horario };
}

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function jput(path, valor) {
  const r = await fetch(`${DB}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(valor),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

/* Acha o jogo do Brasil num scoreboard e devolve { ev, comp, bra, adv }. */
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
const terminou = (ev) =>
  ev?.status?.type?.completed === true || ev?.status?.type?.state === "post";

/* Grava placar se o jogo terminou e ainda não há resultado registrado. */
async function gravaResultado(id, bra, adv, ev, log) {
  const atual = await jget(`${DB}/resultados/${id}.json`).catch(() => null);
  if (atual && atual.h != null && atual.a != null) {
    log(`· ${id}: já tem resultado (${atual.h}x${atual.a}) — mantido`);
    return 0;
  }
  if (!terminou(ev)) { log(`· ${id}: Brasil x ${adv.team.displayName} ainda não terminou — aguarda`); return 0; }
  const h = Number(bra.score), a = Number(adv.score);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return 0;
  await jput(`resultados/${id}`, { h, a });
  log(`✓ ${id}: placar gravado — Brasil ${h} x ${a} ${adv.team.displayName}`);
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

  /* ---------- 2) Mata-mata (descoberta por fase) ---------- */
  const ini = new Date(KO_INICIO + "T12:00Z"), fim = new Date(KO_FIM + "T12:00Z");
  const vistos = new Set();
  for (let t = new Date(ini); t <= fim; t = new Date(t.getTime() + 86400000)) {
    const dia = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
    let data;
    try { data = await jget(ESPN + dia); } catch { continue; }
    const j = jogoDoBrasil(data);
    if (!j) continue;

    const fase = (data.leagues?.[0]?.season?.type?.name) || "";
    const par = FASE_PARA_ID.find(([re]) => re.test(fase));
    if (!par) continue;                         // ainda fase de grupos ou fase desconhecida
    const id = par[1];
    if (vistos.has(id)) continue;               // primeiro jogo do Brasil naquela fase
    vistos.add(id);

    // grava/atualiza data + adversário descobertos
    const quando = brasilia(j.ev.date) || {};
    const advNome = j.adv.team.displayName;
    const meta = { data: quando.data, horario: quando.horario, fora: advNome, flagFora: flagDe(advNome) };
    const atualMeta = await jget(`${DB}/datas/${id}.json`).catch(() => null);
    if (JSON.stringify(atualMeta) !== JSON.stringify(meta)) {
      await jput(`datas/${id}`, meta);
      log(`✓ ${id}: ${fase} definida — ${meta.data} ${meta.horario} vs ${advNome}`);
      datasNovas++;
    } else {
      log(`· ${id}: ${fase} já registrada (${meta.data} vs ${advNome})`);
    }

    gravados += await gravaResultado(id, j.bra, j.adv, j.ev, log);
  }

  console.log(`\nResumo: ${datasNovas} data(s) definida(s), ${gravados} resultado(s) gravado(s).`);
}

main().catch((e) => { console.error("Erro:", e); process.exit(1); });
