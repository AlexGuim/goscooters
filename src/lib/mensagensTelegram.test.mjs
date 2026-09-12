// Testes de src/lib/mensagensTelegram.ts (alerta de procedimento e novo pedido, no Telegram).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertaProcedimentoTelegram, novoPedidoTelegram } from "./mensagensTelegram.ts";

const ORIGEM = "https://goscooters.example";

// O contexto que o intake passa ao motor numa coima (e que o Telegram levava).
const CTX = {
  veiculo_id: "5b0f3c1e-0000-4000-8000-000000000001",
  motorista_id: "9a7d2b44-0000-4000-8000-000000000002",
  nome: "Maria Silva",
  matricula: "AA-00-BB",
  valor: "123.45",
  data: "12/07/2026",
  local: "A5, pórtico de Oeiras",
  documento_url: "infracoes/aviso-coima.pdf",
  categoria: "coima",
};

// Tudo o que o cliente preenche no pedido do site.
const PEDIDO = {
  pedidoId: "8d0c7a52-0000-4000-8000-000000000003",
  nome: "Maria Silva",
  telefone: "+351912345678",
  email: "maria.silva@example.com",
  motoModelo: "Honda PCX 125",
  plataforma: "Uber Eats",
  dataInicio: "2026-10-01",
  duracaoTexto: "3 semanas",
  mensagem: "Preciso da mota para sexta, moro na Rua das Flores 12",
};

const PAGINAS = {
  coima_registada: "/admin/despesas",
  portagem_registada: "/admin/despesas",
  seguro_registado: "/admin/motas",
  seguro_a_expirar: "/admin/notificacoes",
  manutencao_a_vencer: "/admin/notificacoes",
  doc_motorista_a_expirar: "/admin/notificacoes",
  pagamento_a_vencer: "/admin/notificacoes",
};

/** Nem os valores proibidos, nem nada com forma de email, telefone, data, matrícula ou valor (tirando o link). */
function semDadosPessoais(texto, proibidos) {
  for (const p of proibidos) assert.ok(!texto.includes(p), `não devia conter "${p}":\n${texto}`);
  const semLink = texto.replace(/\[[^\]]*\]\([^)]*\)/g, "");
  assert.doesNotMatch(semLink, /@/, "email");
  assert.doesNotMatch(semLink, /\+?\d[\d\s]{7,}\d/, "telefone");
  assert.doesNotMatch(semLink, /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/, "data");
  assert.doesNotMatch(semLink, /[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}/, "matrícula");
  assert.doesNotMatch(semLink, /\d+[.,]\d{2}|€/, "valor");
}

test("alerta de procedimento: o evento, o nome do procedimento e o link — mais nada", () => {
  assert.equal(
    alertaProcedimentoTelegram({ ...CTX, procedimento: "Avisar o gestor das coimas", gatilho: "coima_registada" }, ORIGEM),
    "⚠️ *Coima registada*\n" + "Procedimento: Avisar o gestor das coimas\n\n" + `[Abrir as despesas](${ORIGEM}/admin/despesas)`,
  );
});

test("alerta de procedimento, em TODOS os gatilhos: nem matrícula, nem valor, nem data, nem local, nem nomes", () => {
  for (const [gatilho, pagina] of Object.entries(PAGINAS)) {
    const texto = alertaProcedimentoTelegram({ ...CTX, procedimento: "Avisar o gestor", gatilho }, ORIGEM);
    const linhas = texto.split("\n");
    assert.equal(linhas.length, 4, `${gatilho}: 4 linhas\n${texto}`);
    assert.match(linhas[0], /^⚠️ \*[^*]+\*$/u);
    assert.equal(linhas[1], "Procedimento: Avisar o gestor");
    assert.equal(linhas[2], "");
    assert.ok(linhas[3].endsWith(`](${ORIGEM}${pagina})`), `${gatilho}: link para ${pagina}`);
    semDadosPessoais(texto, [
      CTX.matricula, CTX.valor, "123", CTX.data, CTX.local, "Oeiras", "Maria", "Silva",
      CTX.documento_url, CTX.veiculo_id, CTX.motorista_id,
    ]);
  }
});

test("gatilho desconhecido: 'Outro evento', sem o nome do gatilho, e o link para as notificações", () => {
  assert.equal(
    alertaProcedimentoTelegram({ procedimento: "Avisar", gatilho: "toString_AA-00-BB" }, ORIGEM),
    `⚠️ *Outro evento*\nProcedimento: Avisar\n\n[Abrir as notificações](${ORIGEM}/admin/notificacoes)`,
  );
});

test("novo pedido: só o aviso, o modelo da mota e o link para os Pedidos", () => {
  assert.equal(
    novoPedidoTelegram(PEDIDO, ORIGEM),
    "🛵 *Novo pedido de aluguer*\n" + "Mota: Honda PCX 125\n\n" + `[Abrir os pedidos](${ORIGEM}/admin/pedidos)`,
  );
});

test("novo pedido: nunca leva nome, telefone, email, mensagem nem outro dado do cliente", () => {
  const texto = novoPedidoTelegram(PEDIDO, ORIGEM);
  semDadosPessoais(texto, [
    "Maria", "Silva", PEDIDO.telefone, "912345678", PEDIDO.email, "maria.silva",
    PEDIDO.mensagem, "sexta", "Rua das Flores", PEDIDO.dataInicio, PEDIDO.plataforma,
    PEDIDO.duracaoTexto, PEDIDO.pedidoId,
  ]);
});

test("texto que não é fixo: numa linha e sem Markdown que parta a mensagem", () => {
  const texto = alertaProcedimentoTelegram(
    { procedimento: "Coimas *urgentes*\n_já_ [ver](http://x)", gatilho: "coima_registada" },
    `${ORIGEM}/`,
  );
  assert.equal(texto.split("\n").length, 4);
  assert.ok(texto.includes("Procedimento: Coimas \\*urgentes\\* \\_já\\_ \\[ver](http://x)\n"), texto);
  // A barra final da origem não duplica.
  assert.ok(texto.endsWith(`[Abrir as despesas](${ORIGEM}/admin/despesas)`), texto);
  assert.ok(novoPedidoTelegram({ motoModelo: "PCX_125" }, ORIGEM).includes("Mota: PCX\\_125\n"));
});
