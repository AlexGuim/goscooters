import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { documentoDoDetalhe } from "@/lib/documentoDespesa";

/**
 * Que linhas usam um documento — `detalhe.documento_url` em despesa, seguro e
 * manutenção. Serve para não apagar nem mover um ficheiro de que alguém depende
 * (uma despesa de manutenção e a manutenção espelho partilham o mesmo).
 *
 * Módulo à parte de documentoDespesaServidor.ts de propósito: o fotoActions usa-o,
 * e o documentoDespesaServidor importa o fotoActions — assim não há ciclo.
 * Não verifica a sessão: chama-se depois de requireAdmin/requireAdminForAction.
 */

export type LinhaComDocumento = {
  tabela: "despesa" | "seguro" | "manutencao";
  id: string;
  /** Só nas despesas. */
  categoria: string | null;
  detalhe: unknown;
  documento: string;
};

/** As linhas cujo documento é um destes valores. Null se alguma leitura falhar (na dúvida, ninguém mexe). */
export async function linhasComDocumento(valores: readonly string[]): Promise<LinhaComDocumento[] | null> {
  const unicos = [...new Set(valores.filter((v) => typeof v === "string" && v))];
  if (!unicos.length) return [];
  const [despesas, seguros, manutencoes] = await Promise.all([
    supabaseAdmin.from("despesa").select("id, categoria, detalhe").in("detalhe->>documento_url", unicos),
    supabaseAdmin.from("seguro").select("id, detalhe").in("detalhe->>documento_url", unicos),
    supabaseAdmin.from("manutencao").select("id, detalhe").in("detalhe->>documento_url", unicos),
  ]);
  const erro = despesas.error ?? seguros.error ?? manutencoes.error;
  if (erro) {
    console.error("linhasComDocumento:", erro.message);
    return null;
  }
  const linhas: LinhaComDocumento[] = [];
  const juntar = (tabela: LinhaComDocumento["tabela"], id: string, categoria: string | null, detalhe: unknown) => {
    const documento = documentoDoDetalhe(detalhe);
    if (documento) linhas.push({ tabela, id, categoria, detalhe, documento });
  };
  for (const d of despesas.data ?? []) juntar("despesa", d.id, d.categoria ?? null, d.detalhe);
  for (const s of seguros.data ?? []) juntar("seguro", s.id, null, s.detalhe);
  for (const m of manutencoes.data ?? []) juntar("manutencao", m.id, null, m.detalhe);
  return linhas;
}

/**
 * Troca o documento `de` por `para` nas linhas que ainda o usam (menos a despesa
 * `excetoDespesaId`, que o chamador grava ele próprio). Condicional: uma linha que
 * entretanto mudou de documento não é pisada. True se todas ficaram atualizadas.
 */
export async function reapontarDocumento(de: string, para: string, excetoDespesaId?: string): Promise<boolean> {
  const linhas = await linhasComDocumento([de]);
  if (!linhas) return false;
  let tudoOk = true;
  for (const l of linhas) {
    if (l.documento !== de || (l.tabela === "despesa" && l.id === excetoDespesaId)) continue;
    const base = l.detalhe && typeof l.detalhe === "object" && !Array.isArray(l.detalhe) ? l.detalhe : {};
    const detalhe = { ...(base as Record<string, unknown>), documento_url: para };
    const { error } =
      l.tabela === "despesa"
        ? await supabaseAdmin.from("despesa").update({ detalhe }).eq("id", l.id).eq("detalhe->>documento_url", de)
        : l.tabela === "seguro"
          ? await supabaseAdmin.from("seguro").update({ detalhe }).eq("id", l.id).eq("detalhe->>documento_url", de)
          : await supabaseAdmin.from("manutencao").update({ detalhe }).eq("id", l.id).eq("detalhe->>documento_url", de);
    if (error) {
      console.error(`reapontarDocumento (${l.tabela}):`, error.message);
      tudoOk = false;
    }
  }
  return tudoOk;
}
