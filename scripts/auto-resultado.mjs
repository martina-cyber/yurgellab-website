/* ====================================================================
   Bolão Yurgel Lab — gravação automática do placar oficial.

   Rodado pelo GitHub Action (cron). Para cada jogo do Brasil com data
   definida em bolao-fixtures.json, consulta o placar na API pública da
   ESPN; se a partida já terminou e ainda não há resultado no Firebase,
   grava em resultados/<id>. A classificação no site recalcula sozinha.

   Mesma lógica do auto-fetch que roda no navegador, mas independente de
   alguém ter o site aberto. Registro manual continua tendo prioridade:
   se já existe valor em resultados/<id>, o script não sobrescreve.
   ==================================================================== */
import { readFile } from "node:fs/promises";

const DB   = "https://bolao-yurgel-default-rtdb.firebaseio.com";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=";

const ddmmyyyyToEspn = (d) => {
  const m = String(d || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + m[2] + m[1] : null;        // dd/mm/yyyy -> yyyymmdd
};
const isBrasil = (t) =>
  /brazil|brasil|\bBRA\b/i.test((t?.displayName || "") + " " + (t?.abbreviation || "") + " " + (t?.name || ""));

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
}

async function main() {
  const fixtures = JSON.parse(await readFile(new URL("../bolao-fixtures.json", import.meta.url), "utf8"));
  let gravados = 0;

  for (const fx of fixtures) {
    const dia = ddmmyyyyToEspn(fx.date);
    if (!dia) { console.log(`· ${fx.id}: sem data definida — ignorado`); continue; }

    // não sobrescreve resultado já registrado (manual ou anterior)
    const atual = await jget(`${DB}/resultados/${fx.id}.json`).catch(() => null);
    if (atual && atual.h != null && atual.a != null) {
      console.log(`· ${fx.id}: já tem resultado (${atual.h}x${atual.a}) — mantido`);
      continue;
    }

    let data;
    try { data = await jget(ESPN + dia); }
    catch (e) { console.log(`! ${fx.id}: ESPN indisponível (${e.message})`); continue; }

    let tratado = false;
    for (const ev of (data.events || [])) {
      const comp = (ev.competitions || [])[0];
      const cs = comp ? (comp.competitors || []) : [];
      const bra = cs.find((c) => isBrasil(c.team));
      const adv = cs.find((c) => c !== bra);
      if (!bra || !adv) continue;              // não é o jogo do Brasil
      tratado = true;

      const fim = ev.status?.type?.completed === true || ev.status?.type?.state === "post";
      const h = Number(bra.score), a = Number(adv.score);
      if (!fim || !Number.isFinite(h) || !Number.isFinite(a)) {
        console.log(`· ${fx.id}: Brasil x ${adv.team.displayName} ainda não terminou — aguarda`);
        break;
      }

      const r = await fetch(`${DB}/resultados/${fx.id}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ h, a }),
      });
      if (!r.ok) { console.log(`! ${fx.id}: falha ao gravar (HTTP ${r.status})`); break; }
      console.log(`✓ ${fx.id}: gravado Brasil ${h} x ${a} ${adv.team.displayName}`);
      gravados++;
      break;
    }
    if (!tratado) console.log(`· ${fx.id}: jogo do Brasil não encontrado na ESPN nessa data`);
  }

  console.log(`\nResumo: ${gravados} resultado(s) gravado(s).`);
}

main().catch((e) => { console.error("Erro:", e); process.exit(1); });
