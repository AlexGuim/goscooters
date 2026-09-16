import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/dal";
import { HeroMarca } from "@/components/HeroMarca";
import { saudacaoLisboa } from "@/lib/datas";
import { blocosPorOmissao, type IdBloco } from "@/lib/inicioBlocos";
import BlocoNumeros, { EsqueletoNumeros } from "./inicio/Numeros";
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
 */

/** O conteúdo e o esqueleto de cada bloco do catálogo. */
const BLOCOS: Record<IdBloco, { Conteudo: () => ReactNode | Promise<ReactNode>; Esqueleto: () => ReactNode }> = {
  numeros: { Conteudo: BlocoNumeros, Esqueleto: EsqueletoNumeros },
  acao: { Conteudo: BlocoProximaAcao, Esqueleto: EsqueletoProximaAcao },
};

export default async function AdminInicio() {
  await requireAdmin();

  const { saudacao, data } = saudacaoLisboa();
  const blocos = blocosPorOmissao().filter((b) => b.visivel);

  return (
    <div className="space-y-6">
      <HeroMarca eyebrow={data} titulo={saudacao} />

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
