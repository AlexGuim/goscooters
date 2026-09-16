import NotificacoesList from "../notificacoes/NotificacoesList";
import { Bloco, BlocoFalhou, Barra } from "./Bloco";
import { lerNotificacoes } from "./dados";

/**
 * A caixa de próxima ação: o que há para fazer HOJE, tirado das notificações
 * por resolver. Só lê — o Início nunca recalcula avisos.
 *
 * O «Feito» de cada linha não recarrega o Início: a lista tira a linha do ecrã
 * e a ação só revalida /admin/notificacoes.
 */
export default async function BlocoProximaAcao() {
  let notifs;
  try {
    notifs = await lerNotificacoes();
  } catch (erro) {
    console.error("Início · Caixa de próxima ação:", erro);
    return (
      <Bloco titulo="Caixa de próxima ação">
        <BlocoFalhou />
      </Bloco>
    );
  }

  return (
    <Bloco titulo="Caixa de próxima ação" href="/admin/notificacoes" abrir="Ver todas">
      <NotificacoesList inicial={notifs} />
    </Bloco>
  );
}

/** Três linhas vazias: a altura de uma linha da lista é px-5 py-4 + três linhas de texto. */
export function EsqueletoProximaAcao() {
  return (
    <Bloco titulo="Caixa de próxima ação">
      <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-[90px] items-center gap-3 px-5">
            <Barra className="h-2.5 w-2.5 flex-none rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Barra className="h-5 w-2/3" />
              <Barra className="h-4 w-1/3" />
            </div>
            <Barra className="h-8 w-20 flex-none rounded-2xl" />
          </div>
        ))}
      </div>
    </Bloco>
  );
}
