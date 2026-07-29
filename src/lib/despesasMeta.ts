import type { BadgeTom } from "@/components/ui";
import type { DespesaCategoria, EstadoPagamentoDespesa, ImputarA } from "@/types/db";

/**
 * Metadados de apresentação das despesas (rótulos, cores, tons de badge),
 * partilhados entre o admin (DespesasList) e o portal do parceiro para não
 * duplicar os mapas. Só constantes — seguro de importar em servidor ou cliente.
 */

export const CAT_ROTULO: Record<DespesaCategoria, string> = {
  manutencao: "Manutenção",
  portagem: "Portagem",
  coima: "Coima",
  seguro: "Seguro",
  gps: "GPS",
  comissao: "Comissão",
  outro: "Outro",
};

export const CAT_COR: Record<DespesaCategoria, string> = {
  manutencao: "bg-blue-100 text-blue-700",
  portagem: "bg-purple-100 text-purple-700",
  coima: "bg-red-100 text-red-700",
  seguro: "bg-emerald-100 text-emerald-700",
  gps: "bg-slate-100 text-slate-700",
  comissao: "bg-amber-100 text-amber-800",
  outro: "bg-slate-100 text-slate-600",
};

export const ESTADO_PAG_TOM: Record<EstadoPagamentoDespesa, BadgeTom> = {
  pendente: "warning",
  parcial: "warning",
  paga: "success",
  isenta: "neutral",
};

export const IMPUTAR_ROTULO: Record<ImputarA, string> = {
  goscooters: "GoScooters",
  proprietario: "Proprietário",
  motorista: "Motorista",
};
