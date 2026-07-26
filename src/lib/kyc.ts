// Fonte ÚNICA da definição de "KYC completo" de um motorista. Usada tanto na
// notificação derivada (kyc_incompleto) como no badge da ficha, para não haver
// duas definições que discordam.
//
// KYC completo = NIF (presente e não inválido) + documento de identidade +
// carta de condução + morada. Deliberadamente FORA:
//  - IBAN: o negócio é pay-and-ride (o motorista paga a plataforma), não recebe.
//  - datas de validade: informativas, não bloqueiam (o OCR pode falhá-las).
//  - doc_urls (ficheiros): muitos registos migrados têm os dados mas não a cópia.
// nif_valido === null é ACEITÁVEL (imigrante sem NIF-PT); só false (checksum
// falhado) bloqueia — é um NIF presente mas errado.

export type MotoristaKYC = {
  nif?: string | null;
  nif_valido?: boolean | null;
  doc_id_numero?: string | null;
  carta_numero?: string | null;
  morada_linha1?: string | null;
};

const preenchido = (v?: string | null) => !!v && v.trim() !== "";

export function kycCompleto(m: MotoristaKYC): { completo: boolean; faltam: string[] } {
  const faltam: string[] = [];
  if (!preenchido(m.nif)) faltam.push("NIF");
  else if (m.nif_valido === false) faltam.push("NIF inválido");
  if (!preenchido(m.doc_id_numero)) faltam.push("documento de identidade");
  if (!preenchido(m.carta_numero)) faltam.push("carta de condução");
  if (!preenchido(m.morada_linha1)) faltam.push("morada");
  return { completo: faltam.length === 0, faltam };
}
