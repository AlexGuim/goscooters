// Testes de src/lib/fechoGestao.ts (o fecho de gestão do Resultado, em cascata).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechoGestao,
  juntarParcelas,
  despesasDoMes,
  despesasPorDono,
  despesasDoNegocio,
} from "./fechoGestao.ts";
import { rubricaDoDetalhe } from "./custos.ts";
import { CAT_ROTULO } from "./despesasMeta.ts";

// O catálogo real: os rótulos que o ecrã das despesas já usa e a lista única das rubricas.
const CATALOGO = { rotuloCategoria: CAT_ROTULO, rubricaDe: rubricaDoDetalhe };

/** Uma despesa com valores por omissão: manutenção da casa numa mota, sem rubrica. */
const desp = (campos) => ({
  data_despesa: "2026-08-10",
  categoria: "manutencao",
  imputar_a: "goscooters",
  veiculo_id: "mota-1",
  proprietario_id: null,
  valor_total: "0.00",
  detalhe: null,
  ...campos,
});

/** Custo da empresa: da casa e sem mota. */
const semMota = (campos) => desp({ veiculo_id: null, categoria: "outro", ...campos });

/** O detalhe de uma despesa com esta rubrica (e o resto que a leitura da fatura lá deixa). */
const comRubrica = (rubrica) => ({ documento_url: "https://exemplo.pt/fatura.pdf", rubrica });

test("a cascata: receita − custos da frota = margem; margem − custos da empresa = resultado", () => {
  const f = fechoGestao(
    1188.4,
    [
      desp({ valor_total: "65.00" }),
      desp({ veiculo_id: "mota-2", valor_total: "29.50" }),
      desp({ categoria: "gps", valor_total: "10.00" }),
      semMota({ detalhe: comRubrica("contabilidade"), valor_total: "123.00" }),
    ],
    CATALOGO,
  );
  assert.equal(f.receita, 1188.4);
  assert.equal(f.custos_frota, 104.5);
  assert.equal(f.margem_frota, 1083.9);
  assert.equal(f.custos_empresa, 123);
  assert.equal(f.resultado, 960.9);
});

test("a regra é uma só: com mota é custo da frota, sem mota é custo da empresa", () => {
  const f = fechoGestao(0, [desp({ valor_total: "40.00" }), semMota({ valor_total: "15.00" })], CATALOGO);
  assert.equal(f.custos_frota, 40);
  assert.equal(f.custos_empresa, 15);
});

test("uma despesa com mota fica na frota mesmo que traga rubrica: a mota manda", () => {
  const f = fechoGestao(
    0,
    [desp({ categoria: "seguro", detalhe: comRubrica("seguros_empresa"), valor_total: "200.00" })],
    CATALOGO,
  );
  assert.equal(f.custos_empresa, 0);
  assert.deepEqual(f.custos_frota_por_categoria, [{ chave: "categoria:seguro", rotulo: "Seguro", valor: 200 }]);
});

test("coimas e portagens do motorista e despesas do proprietário nunca são custos da casa", () => {
  const f = fechoGestao(
    500,
    [
      semMota({ imputar_a: "motorista", categoria: "coima", valor_total: "60.00" }),
      desp({ imputar_a: "motorista", categoria: "portagem", valor_total: "36.84" }),
      desp({ imputar_a: "proprietario", proprietario_id: "dono-p", valor_total: "80.00" }),
      semMota({ imputar_a: "proprietario", proprietario_id: "dono-p", valor_total: "15.00" }),
    ],
    CATALOGO,
  );
  assert.deepEqual(f, {
    receita: 500,
    custos_frota: 0,
    custos_frota_por_categoria: [],
    margem_frota: 500,
    custos_empresa: 0,
    custos_empresa_por_rubrica: [],
    resultado: 500,
  });
});

test("custos da frota abertos por categoria, com o rótulo que já existe, do maior para o menor", () => {
  const f = fechoGestao(
    0,
    [
      desp({ categoria: "portagem", valor_total: "10.00" }),
      desp({ valor_total: "65.00" }),
      desp({ veiculo_id: "mota-2", valor_total: "29.50" }),
      desp({ categoria: "gps", valor_total: "10.00" }),
    ],
    CATALOGO,
  );
  assert.deepEqual(f.custos_frota_por_categoria, [
    { chave: "categoria:manutencao", rotulo: "Manutenção", valor: 94.5 },
    { chave: "categoria:gps", rotulo: "GPS", valor: 10 },
    { chave: "categoria:portagem", rotulo: "Portagem", valor: 10 },
  ]);
});

test("custos da empresa por rubrica: a rubrica válida manda; sem ela, a categoria com o seu rótulo", () => {
  const f = fechoGestao(
    0,
    [
      semMota({ detalhe: comRubrica("contabilidade"), valor_total: "123.00" }),
      semMota({ detalhe: { rubrica: "contabilidade" }, valor_total: "7.00" }),
      semMota({ categoria: "seguro", detalhe: comRubrica("seguros_empresa"), valor_total: "90.00" }),
      semMota({ detalhe: null, valor_total: "20.00" }),
      semMota({ detalhe: comRubrica("Contabilidade"), valor_total: "5.00" }), // o rótulo em vez do id: não é válida
      semMota({ detalhe: comRubrica(7), valor_total: "3.00" }),
      semMota({ categoria: "coima", valor_total: "50.00" }), // coima que ficou para a casa, sem mota
    ],
    CATALOGO,
  );
  assert.deepEqual(f.custos_empresa_por_rubrica, [
    { chave: "rubrica:contabilidade", rotulo: "Contabilidade", valor: 130 },
    { chave: "rubrica:seguros_empresa", rotulo: "Seguros da empresa", valor: 90 },
    { chave: "categoria:coima", rotulo: "Coima", valor: 50 },
    { chave: "categoria:outro", rotulo: "Outro", valor: 28 },
  ]);
  assert.equal(f.custos_empresa, 298);
});

test("valores como vêm da base (texto), pagos ou não, ao cêntimo; o resultado pode ser negativo", () => {
  const f = fechoGestao(
    0.1,
    [
      desp({ valor_total: "10.10", estado_pagamento: "paga" }),
      desp({ valor_total: "20.20", estado_pagamento: "pendente" }),
      desp({ valor_total: "0.03" }),
      semMota({ valor_total: "0.20" }),
    ],
    CATALOGO,
  );
  assert.equal(f.custos_frota, 30.33);
  assert.equal(f.margem_frota, -30.23);
  assert.equal(f.custos_empresa, 0.2);
  assert.equal(f.resultado, -30.43);
});

test("categoria sem rótulo conhecido mostra o próprio nome, e não uma propriedade herdada", () => {
  const f = fechoGestao(
    0,
    [desp({ categoria: "nova_categoria", valor_total: "1.00" }), desp({ categoria: "toString", valor_total: "2.00" })],
    CATALOGO,
  );
  assert.deepEqual(
    f.custos_frota_por_categoria.map((p) => p.rotulo),
    ["toString", "nova_categoria"],
  );
});

test("despesasDoMes: pela data da fatura, do primeiro ao último dia do mês", () => {
  const lista = ["2026-07-31", "2026-08-01", "2026-08-31", "2026-09-01", "2025-08-15"].map((data_despesa) =>
    desp({ data_despesa }),
  );
  assert.deepEqual(
    despesasDoMes(lista, "2026-08").map((d) => d.data_despesa),
    ["2026-08-01", "2026-08-31"],
  );
});

test("juntarParcelas: este mês e o anterior lado a lado, 0 onde faltar, do maior para o menor neste mês", () => {
  const este = [
    { chave: "categoria:manutencao", rotulo: "Manutenção", valor: 94.5 },
    { chave: "categoria:gps", rotulo: "GPS", valor: 10 },
  ];
  const anterior = [
    { chave: "categoria:portagem", rotulo: "Portagem", valor: 36.84 },
    { chave: "categoria:manutencao", rotulo: "Manutenção", valor: 294 },
  ];
  assert.deepEqual(juntarParcelas(este, anterior), [
    { chave: "categoria:manutencao", rotulo: "Manutenção", este: 94.5, anterior: 294 },
    { chave: "categoria:gps", rotulo: "GPS", este: 10, anterior: 0 },
    { chave: "categoria:portagem", rotulo: "Portagem", este: 0, anterior: 36.84 },
  ]);
  assert.deepEqual(juntarParcelas([], []), []);
});

// Um mês com um pouco de tudo, para as contas por dono e do negócio.
const DONO_PROPRIO = new Map([["mota-propria", "dono-gs"]]);
const MISTO = [
  desp({ veiculo_id: "mota-propria", valor_total: "65.00" }),
  semMota({ detalhe: comRubrica("contabilidade"), valor_total: "123.00" }),
  desp({ veiculo_id: "mota-parceiro", valor_total: "40.00" }),
  desp({ imputar_a: "proprietario", proprietario_id: "dono-p", veiculo_id: "mota-parceiro", valor_total: "80.00" }),
  desp({ imputar_a: "motorista", categoria: "portagem", veiculo_id: "mota-propria", valor_total: "36.84" }),
];

test("por dono: a frota própria só leva os custos das motas próprias; os da empresa ficam à parte", () => {
  const r = despesasPorDono(MISTO, DONO_PROPRIO);
  assert.deepEqual(
    [...r.por_dono].sort(),
    [
      ["dono-gs", 65],
      ["dono-p", 80],
    ],
  );
  assert.equal(r.custos_empresa, 123);
  assert.equal(r.casa_noutras_motas, 40);
  assert.equal(r.proprietario_sem_dono, 0);
});

test("por dono: a soma bate com a cascata e com o negócio todo", () => {
  const r = despesasPorDono(MISTO, DONO_PROPRIO);
  const f = fechoGestao(0, MISTO, CATALOGO);
  const n = despesasDoNegocio(MISTO);
  const somaDonos = [...r.por_dono.values()].reduce((a, b) => a + b, 0);
  // A linha à parte é exatamente a dos «Custos da empresa» da cascata…
  assert.equal(r.custos_empresa, f.custos_empresa);
  // …as motas próprias e as outras a cargo da casa são os «Custos da frota»…
  assert.equal(r.por_dono.get("dono-gs") + r.casa_noutras_motas, f.custos_frota);
  // …e tudo junto dá as despesas do negócio todo.
  assert.equal(somaDonos + r.custos_empresa + r.casa_noutras_motas + r.proprietario_sem_dono, n.total);
});

test("despesa de proprietário sem dono atribuído aparece à parte, em vez de desaparecer", () => {
  const lista = [
    ...MISTO,
    desp({ imputar_a: "proprietario", proprietario_id: null, veiculo_id: "mota-parceiro", valor_total: "12.50" }),
    semMota({ imputar_a: "proprietario", proprietario_id: null, valor_total: "7.50" }),
  ];
  const r = despesasPorDono(lista, DONO_PROPRIO);
  const n = despesasDoNegocio(lista);
  const somaDonos = [...r.por_dono.values()].reduce((a, b) => a + b, 0);
  assert.equal(r.proprietario_sem_dono, 20);
  // Continua a bater com o negócio todo: é isso que a tabela promete ao gestor.
  assert.equal(somaDonos + r.custos_empresa + r.casa_noutras_motas + r.proprietario_sem_dono, n.total);
});

test("o negócio todo: casa e parceiros; o do motorista é adiantado, não despesa", () => {
  assert.deepEqual(despesasDoNegocio(MISTO), {
    total: 308,
    por_imputacao: [
      { imputar_a: "goscooters", valor: 228 },
      { imputar_a: "proprietario", valor: 80 },
    ],
    adiantado_motoristas: 36.84,
  });
  assert.deepEqual(despesasDoNegocio([]), { total: 0, por_imputacao: [], adiantado_motoristas: 0 });
});
