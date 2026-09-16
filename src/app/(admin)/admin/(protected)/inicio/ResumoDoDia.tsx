import { lerNumeros } from "./dados";

/**
 * A frase do dia, na faixa do topo: «2 ações por resolver · 1 em atraso».
 *
 * Vive aqui, e não dentro do bloco Números, porque é a primeira coisa que se lê
 * ao abrir o Início — e porque o Início passou a ser configurável: quem esconda
 * os Números continua a ver o resumo. Tem a sua própria espera (Suspense), para
 * não atrasar a faixa; se a leitura falhar, não mostra nada (os blocos é que
 * avisam), em vez de escrever um zero que não é verdade.
 */
export default async function ResumoDoDia() {
  let n;
  try {
    n = await lerNumeros();
  } catch (erro) {
    console.error("Início · resumo do dia:", erro);
    return null;
  }

  const partes: string[] = [];
  if (n.por_resolver)
    partes.push(`${n.por_resolver} ${n.por_resolver === 1 ? "ação por resolver" : "ações por resolver"}`);
  if (n.em_atraso) partes.push(`${n.em_atraso} em atraso`);

  return <>{partes.length ? partes.join(" · ") : "Sem pendências — está tudo em dia."}</>;
}
