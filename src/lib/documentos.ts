/**
 * Interpretação de documentos de identidade a partir do TEXTO já reconhecido
 * (OCR do browser, ver src/lib/ocr.ts). Lê a zona MRZ (ICAO 9303) do passaporte
 * (TD3, 2×44) e do cartão de cidadão / título de residência (TD1, 3×30). A MRZ
 * é independente do país e tem posições fixas, por isso é a parte mais fiável.
 * Tudo é best-effort — o resultado é sempre confirmado por uma pessoa.
 */
export interface DadosDocumento {
  nome: string | null;
  numero: string | null;
  nacionalidade: string | null; // ISO-3 da MRZ
  nascimento: string | null; // ISO AAAA-MM-DD
  validade: string | null; // ISO
  tipo: "passaporte" | "cc" | null;
}

const VAZIO: DadosDocumento = {
  nome: null, numero: null, nacionalidade: null, nascimento: null, validade: null, tipo: null,
};

/** YYMMDD → ISO. `futuro` (validade) assume século 2000; senão infere. */
function dataMRZ(s: string, futuro: boolean): string | null {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2));
  const mm = s.slice(2, 4);
  const dd = s.slice(4, 6);
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  const nowYY = new Date().getFullYear() % 100;
  const ano = futuro ? 2000 + yy : yy > nowYY ? 1900 + yy : 2000 + yy;
  return `${ano}-${mm}-${dd}`;
}

/** "SURNAME<<GIVEN<NAMES" → "Given Names Surname" (aproximado, maiúsculas). */
function nomeMRZ(campo: string): string | null {
  const partes = campo.split("<<");
  const apelido = (partes[0] ?? "").replace(/</g, " ").trim();
  const proprios = (partes[1] ?? "").replace(/</g, " ").trim();
  const nome = `${proprios} ${apelido}`.replace(/\s+/g, " ").trim();
  return nome || null;
}

const soMRZ = (l: string) => l.toUpperCase().replace(/[^A-Z0-9<]/g, "");

export function interpretarDocumento(textoOcr: string): DadosDocumento {
  const linhas = textoOcr
    .split("\n")
    .map(soMRZ)
    .filter((l) => l.length >= 28 && l.includes("<"));

  // TD3 (passaporte): duas linhas ~44, a 1.ª começa por P.
  const td3 = linhas.filter((l) => l.length >= 42 && l.length <= 46);
  if (td3.length >= 2) {
    const l1 = td3.find((l) => l.startsWith("P")) ?? td3[0];
    const l2 = td3.find((l) => l !== l1) ?? td3[1];
    if (l1 && l2 && l2.length >= 28) {
      const nome = nomeMRZ(l1.slice(5));
      const numero = l2.slice(0, 9).replace(/</g, "").trim() || null;
      const nacionalidade = l2.slice(10, 13).replace(/</g, "") || null;
      const nascimento = dataMRZ(l2.slice(13, 19), false);
      const validade = dataMRZ(l2.slice(21, 27), true);
      return { nome, numero, nacionalidade, nascimento, validade, tipo: "passaporte" };
    }
  }

  // TD1 (cartão de cidadão / título de residência): três linhas ~30.
  const td1 = linhas.filter((l) => l.length >= 28 && l.length <= 32);
  if (td1.length >= 3) {
    const [l1, l2, l3] = td1;
    const numero = l1.slice(5, 14).replace(/</g, "").trim() || null;
    const nascimento = dataMRZ(l2.slice(0, 6), false);
    const validade = dataMRZ(l2.slice(8, 14), true);
    const nacionalidade = l2.slice(15, 18).replace(/</g, "") || null;
    const nome = nomeMRZ(l3);
    return { nome, numero, nacionalidade, nascimento, validade, tipo: "cc" };
  }

  return VAZIO;
}
