// Noticias de una cripto para Mi plata.
// Google Noticias no deja que una página web le pida titulares directamente,
// así que esta función los busca, saca los repetidos y devuelve los 5 más nuevos:
// primero en español y, si no alcanzan, completa con inglés.
//
// Uso: GET /functions/v1/noticias?q=Bitcoin
// Se publica en Supabase: Edge Functions → Deploy a new function → Via Editor,
// con el nombre "noticias", y con "Enforce JWT verification" apagado.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type Nota = { titulo: string; fuente: string; url: string; fecha: string; idioma: "es" | "en" };

// Palabras que no dicen de qué trata una nota
const VACIAS = new Set([
  "para", "como", "sobre", "entre", "desde", "hasta", "este", "esta", "estos", "estas", "tras",
  "ante", "segun", "mas", "hoy", "cuando", "donde", "porque", "pero", "todo", "todos", "nuevo",
  "nueva", "precio", "cripto", "criptomoneda", "criptomonedas", "the", "and", "for", "with",
  "from", "that", "this", "after", "into", "over", "will", "what", "your", "their", "about",
  "price", "crypto", "news", "today",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
  "noviembre", "diciembre", "january", "february", "march", "april", "june", "july", "august",
  "september", "october", "november", "december",
]);

function palabras(texto: string, sacar: Set<string>): Set<string> {
  return new Set(
    texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9ñ ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !/^20\d\d$/.test(w) && !VACIAS.has(w) && !sacar.has(w)),
  );
}

// Dos titulares hablan de lo mismo si comparten la mitad de sus palabras importantes
// (sin contar el nombre de la moneda, que aparece en todos)
function parecidas(a: string, b: string, sacar: Set<string>): boolean {
  const A = palabras(a, sacar), B = palabras(b, sacar);
  if (!A.size || !B.size) return false;
  let comunes = 0;
  A.forEach((w) => { if (B.has(w)) comunes++; });
  return comunes / Math.min(A.size, B.size) >= 0.5;
}

// Google a veces mezcla notas en otros idiomas en la búsqueda en español:
// se decide por las palabras más comunes de cada idioma
const ES = new Set(["de", "la", "el", "en", "y", "los", "las", "del", "que", "por", "con", "para", "se", "su", "un", "una", "al", "es", "sus", "como", "más", "qué", "cómo", "tras"]);
const EN = new Set(["the", "of", "to", "and", "for", "on", "in", "with", "is", "by", "at", "as", "its", "from", "after", "why", "how", "what", "could", "will"]);
function idiomaDe(t: string): "es" | "en" | null {
  if (/[぀-ヿ㐀-鿿가-힯Ѐ-ӿ]/.test(t)) return null;
  const ws = t.toLowerCase().split(/[^a-záéíóúñü]+/);
  const es = ws.filter((w) => ES.has(w)).length + (/[áéíóúñ¿¡]/i.test(t) ? 2 : 0);
  const en = ws.filter((w) => EN.has(w)).length;
  return es > en ? "es" : en > es ? "en" : es ? "es" : null;
}

function limpiar(s: string): string {
  return s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

async function buscar(q: string, idioma: "es" | "en"): Promise<Nota[]> {
  const region = idioma === "es" ? "hl=es-419&gl=AR&ceid=AR:es-419" : "hl=en-US&gl=US&ceid=US:en";
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${region}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Mi plata)" },
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const notas: Nota[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const it = m[1];
      const tag = (n: string) => limpiar((it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || "");
      const fuente = tag("source");
      let titulo = tag("title");
      if (fuente && titulo.endsWith(" - " + fuente)) titulo = titulo.slice(0, -(fuente.length + 3));
      const fecha = new Date(tag("pubDate"));
      const url = tag("link");
      if (titulo && url && !isNaN(fecha.getTime())) notas.push({ titulo, fuente, url, fecha: fecha.toISOString(), idioma });
    }
    return notas;
  } catch {
    return [];
  }
}

function json(cuerpo: unknown, estado = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const nombre = (url.searchParams.get("q") || "").slice(0, 60).trim();
  const simbolo = (url.searchParams.get("s") || "").slice(0, 12).trim().toLowerCase();
  if (!nombre) return json({ error: "Falta el nombre de la moneda (?q=)" }, 400);

  // El titular tiene que nombrar la moneda (por su nombre o su símbolo),
  // si no, suele ser una nota general que la menciona de pasada
  const claves = [nombre.toLowerCase(), simbolo].filter((k) => k.length >= 2);
  const nombra = (t: string) => {
    const tl = " " + t.toLowerCase().replace(/[^a-z0-9áéíóúñü]+/g, " ") + " ";
    return claves.some((k) => tl.includes(" " + k.replace(/[^a-z0-9áéíóúñü]+/g, " ").trim() + " "));
  };

  // ...y hablar de mercado o de cripto: así "Rain" no trae notas del clima
  const MERCADO = /\b(crypto\w*|cript\w*|token\w*|coin\w*|moneda\w*|blockchain|stablecoin\w*|bitcoin|btc|ethereum|eth|defi|exchange\w*|altcoin\w*|web3|trading|trader\w*|precio\w*|price\w*|mercado\w*|market\w*|etf\w*|binance|wallet\w*|billeter\w*|nft\w*|staking|airdrop\w*|memecoin\w*|d[oó]lar\w*|usd\w*|millones|million\w*|billion\w*|bull\w*|bear\w*|alcist\w*|bajist\w*|sube|suben|cae|caen|dispara\w*|desplom\w*|r[eé]cord|capitalizaci[oó]n|volum\w*|futur\w*|perpetu\w*|listing|hack\w*|exploit\w*|inversi\w*|invest\w*|surge\w*|soar\w*|plunge\w*|drop\w*|jump\w*|rall\w*)\b|[$%]/i;

  const sacar = palabras(nombre, new Set());
  const elegidas: Nota[] = [];
  const sumar = (lista: Nota[]) => {
    for (const n of lista.sort((a, b) => b.fecha.localeCompare(a.fecha))) {
      if (elegidas.length >= 5) break;
      if (!nombra(n.titulo) || !MERCADO.test(n.titulo)) continue;
      // repetida: dice lo mismo con otras palabras, o es el mismo medio el mismo día
      const repetida = elegidas.some((e) =>
        parecidas(e.titulo, n.titulo, sacar) ||
        (e.fuente === n.fuente && Math.abs(Date.parse(e.fecha) - Date.parse(n.fecha)) < 864e5)
      );
      if (!repetida) elegidas.push(n);
    }
  };

  // Lo que vino en la búsqueda en español pero está en inglés se guarda para después
  const enEspanol = await buscar(`"${nombre}" cripto when:30d`, "es");
  const sobrantesEn = enEspanol.filter((n) => idiomaDe(n.titulo) === "en").map((n) => ({ ...n, idioma: "en" as const }));
  sumar(enEspanol.filter((n) => idiomaDe(n.titulo) === "es"));
  if (elegidas.length < 5) {
    const enIngles = (await buscar(`"${nombre}" crypto when:30d`, "en")).filter((n) => idiomaDe(n.titulo) === "en");
    sumar([...enIngles, ...sobrantesEn]);
  }

  // 15 minutos de caché: las noticias no cambian tan rápido y así se usa menos la función
  return json(elegidas, 200, { "Cache-Control": "public, max-age=900" });
});
