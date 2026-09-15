// Testes de src/lib/custos.ts (a lista única das rubricas dos custos da empresa).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUBRICAS_EMPRESA, rubricaEmpresa, rubricaDoDetalhe } from "./custos.ts";

test("as 7 rubricas fixas, por esta ordem, com os ids e os rótulos combinados", () => {
  assert.deepEqual(
    RUBRICAS_EMPRESA.map((r) => [r.id, r.rotulo]),
    [
      ["contabilidade", "Contabilidade"],
      ["advogados", "Advogados e notários"],
      ["marketing", "Marketing e publicidade"],
      ["software", "Software e comunicações"],
      ["seguros_empresa", "Seguros da empresa"],
      ["taxas", "Taxas e licenças"],
      ["outros", "Outros da empresa"],
    ],
  );
});

test("ids e rótulos não se repetem", () => {
  assert.equal(new Set(RUBRICAS_EMPRESA.map((r) => r.id)).size, RUBRICAS_EMPRESA.length);
  assert.equal(new Set(RUBRICAS_EMPRESA.map((r) => r.rotulo)).size, RUBRICAS_EMPRESA.length);
});

test("rubricaEmpresa reconhece cada id e devolve a rubrica com o rótulo", () => {
  for (const r of RUBRICAS_EMPRESA) assert.deepEqual(rubricaEmpresa(r.id), r);
});

test("rubricaEmpresa recusa o que não é uma rubrica: vazio, rótulo, categoria, outro tipo", () => {
  const invalidos = [
    undefined,
    null,
    "",
    " contabilidade",
    "Contabilidade",
    "CONTABILIDADE",
    "outro", // é uma categoria de despesa, não uma rubrica
    "seguro",
    "toString",
    "__proto__",
    3,
    true,
    {},
    ["contabilidade"],
    { id: "contabilidade" },
  ];
  for (const v of invalidos) {
    assert.equal(rubricaEmpresa(v), null, JSON.stringify(v) ?? String(v));
  }
});

test("rubricaDoDetalhe lê detalhe.rubrica, se existir e for válida", () => {
  assert.deepEqual(rubricaDoDetalhe({ rubrica: "contabilidade" }), { id: "contabilidade", rotulo: "Contabilidade" });
  // O detalhe traz o resto da leitura da fatura: a rubrica é só mais um campo.
  assert.deepEqual(
    rubricaDoDetalhe({ documento_url: "https://exemplo.pt/f.pdf", fornecedor: "X", rubrica: "software" }),
    { id: "software", rotulo: "Software e comunicações" },
  );
});

test("rubricaDoDetalhe dá null sem detalhe, sem rubrica ou com rubrica inválida", () => {
  const semRubrica = [
    null,
    undefined,
    "",
    "contabilidade",
    5,
    [],
    [{ rubrica: "contabilidade" }],
    {},
    { rubrica: null },
    { rubrica: "Contabilidade" },
    { Rubrica: "contabilidade" },
  ];
  for (const d of semRubrica) {
    assert.equal(rubricaDoDetalhe(d), null, JSON.stringify(d) ?? String(d));
  }
});
