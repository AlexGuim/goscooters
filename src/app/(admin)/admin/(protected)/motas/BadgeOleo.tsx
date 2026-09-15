import type { ReactNode } from "react";
import type { EstadoOleo } from "@/lib/manutencao/oleo";
import { Badge, type BadgeTom } from "@/components/ui";

/**
 * A cor do estado do óleo, num só sítio: a página da mota e a lista da frota têm
 * de dizer o mesmo com a mesma cor.
 */
const TOM: Record<EstadoOleo, BadgeTom> = {
  vencida: "danger",
  a_aproximar: "warning",
  ok: "success",
  sem_dados: "neutral",
  sem_regra: "neutral",
};

export default function BadgeOleo({ estado, children }: { estado: EstadoOleo; children: ReactNode }) {
  return <Badge tom={TOM[estado]}>{children}</Badge>;
}
