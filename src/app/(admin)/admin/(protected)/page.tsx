import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/dal";
import { HeroMarca } from "@/components/HeroMarca";
import { saudacaoLisboa } from "@/lib/datas";
import { lerEscolhaDoInicio, type IdBloco } from "@/lib/inicioBlocos";
import PersonalizarInicio from "./inicio/Personalizar";
import ResumoDoDia from "./inicio/ResumoDoDia";
import BlocoNumeros, { EsqueletoNumeros } from "./inicio/Numeros";
import BlocoCobranca, { EsqueletoCobranca } from "./inicio/Cobranca";
import BlocoResultado, { EsqueletoResultado } from "./inicio/Resultado";
import BlocoProximaAcao, { EsqueletoProximaAcao } from "./inicio/ProximaAcao";

/**
 * O Início, em blocos.
 *
 * Antes era um ecrã só: uma página que esperava por todas as consultas antes de
 * mostrar seja o que for, e em que uma consulta lenta (ou em baixo) levava o
 * resto atrás. Agora cada bloco é um componente de servidor com as SUAS
 * consultas, dentro do seu Suspense: a faixa do topo aparece logo, e cada bloco
 * entra quando estiver pronto, no lugar do seu esqueleto. Um bloco que falhe
 * mostra-o dentro da sua moldura, sem apagar os outros.
 *
 * O Início só LÊ. Não recalcula avisos nem escreve nada.
 *
 * A ordem, a largura e o que está escondido saem da conta do gestor
 * (`user_metadata.inicio`), lidos com desconfiança: sem escolha, com uma escolha
 * estragada ou com ids que já não existem, vale o Início de fábrica. É uma
 * preferência de ecrã — não autoriza nada.
 */

/** O conteúdo e o esqueleto de cada bloco do catálogo. */
const BLOCOS: Record<IdBloco, { Conteudo: () => ReactNode | Promise<ReactNode>; Esqueleto: () => ReactNode }> = {
  numeros: { Conteudo: BlocoNumeros, Esqueleto: EsqueletoNumeros },
  cobranca: { Conteudo: BlocoCobranca, Esqueleto: EsqueletoCobranca },
  resultado: { Conteudo: BlocoResultado, Esqueleto: EsqueletoResultado },
  acao: { Conteudo: BlocoProximaAcao, Esqueleto: EsqueletoProximaAcao },
};

export default async function AdminInicio() {
  const user = await requireAdmin();

  const { saudacao, data } = saudacaoLisboa();
  const escolha = lerEscolhaDoInicio(user.user_metadata?.inicio);
  const blocos = escolha.filter((b) => b.visivel);

  return (
    <div className="space-y-6">
      <HeroMarca
        eyebrow={data}
        titulo={saudacao}
        subtitulo={
          <Suspense fallback={null}>
            <ResumoDoDia />
          </Suspense>
        }
        acao={<PersonalizarInicio inicial={escolha} />}
      />

      {/* Esconder tudo é uma escolha legítima — mas sem isto o Início parecia avariado. */}
      {blocos.length === 0 && (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-600 shadow-sm">
          Não está nenhum bloco à vista. Abre «Personalizar o Início», aqui em cima, para voltar a
          mostrar o que precisas.
        </p>
      )}

      {/* Dois blocos "meia" ficam lado a lado no computador; no telemóvel é tudo em coluna. */}
      <div className="grid gap-6 lg:grid-cols-2">
        {blocos.map(({ id, largura }) => {
          const { Conteudo, Esqueleto } = BLOCOS[id];
          return (
            <div key={id} className={largura === "toda" ? "lg:col-span-2" : ""}>
              <Suspense fallback={<Esqueleto />}>
                <Conteudo />
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>
  );
}
