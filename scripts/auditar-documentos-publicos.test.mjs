// Testes das partes puras de scripts/auditar-documentos-publicos.mjs.
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepararTabelas,
  tabelasQueReferem,
  classificarFicheiros,
  ondeEstaOcorrencia,
  soEmCaminhosPrivados,
} from "./auditar-documentos-publicos.mjs";

const BASE = "https://abcd.supabase.co";
const U1 = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"; // o ficheiro do público
const U2 = "9a8b7c6d-5e4f-4321-8765-43210fedcba9"; // o uuid novo dado ao passar para privado
const U3 = "11111111-2222-4333-8444-555555555555"; // o uuid novo de copiarParaFaturas
const NOME = `${U1}-aviso-portagem.pdf`;
const publico = (caminho) => `${BASE}/storage/v1/object/public/motas/${caminho}`;

/** Estado de NOME perante as tabelas dadas: "orfao", "copia_publica" ou "referenciado". */
function estado(tabelas) {
  const nomes = Object.keys(tabelas);
  const lidas = prepararTabelas(
    nomes,
    nomes.map((n) => tabelas[n]),
  );
  const { orfaos, copiasPublicas } = classificarFicheiros([{ name: NOME, id: "x", metadata: { size: 1 } }], lidas);
  return orfaos.length ? "orfao" : copiasPublicas.length ? "copia_publica" : "referenciado";
}

test("importar o script não o executa (nem lê o .env.local)", () => {
  assert.equal(typeof classificarFicheiros, "function");
});

test("a regra dos órfãos (e do --mover) não muda: o uuid em qualquer sítio do JSON conta", () => {
  const casos = [
    { despesa: [{ detalhe: { documento_url: publico(`faturas/${NOME}`) } }] },
    { despesa: [{ detalhe: { documento_url: `infracoes/${U2}-${U1}-avi.pdf` } }] },
    { motorista: [{ doc_urls: [`kyc/${U2}-${U1}-cc.jpg`] }] },
    { notificacao: [{ mensagem: `texto com ${U1} solto` }] },
    { despesa: [{ detalhe: { documento_url: publico(`faturas/${U2}-outro.pdf`) } }] },
    {},
  ];
  for (const tabelas of casos) {
    const nomes = Object.keys(tabelas);
    const lidas = prepararTabelas(
      nomes,
      nomes.map((n) => tabelas[n]),
    );
    const antiga = nomes.filter((n) => JSON.stringify(tabelas[n]).includes(NOME.slice(0, 36)));
    assert.deepEqual(tabelasQueReferem(NOME, lidas), antiga, JSON.stringify(tabelas));
  }
});

test("sem referência nenhuma → órfão (e só os órfãos vão para a quarentena)", () => {
  assert.equal(estado({ despesa: [{ detalhe: { documento_url: publico(`faturas/${U2}-outro.pdf`) } }] }), "orfao");
  assert.equal(estado({}), "orfao");
});

test("referido por URL público ou caminho faturas/… → referenciado", () => {
  assert.equal(estado({ despesa: [{ detalhe: { documento_url: publico(`faturas/${NOME}`) } }] }), "referenciado");
  assert.equal(estado({ seguro: [{ detalhe: { documento_url: `faturas/${NOME}` } }] }), "referenciado");
  assert.equal(estado({ moto: [{ foto_urls: [publico(`faturas/${NOME}`), publico(`${U2}-foto.jpg`)] }] }), "referenciado");
});

test("o id só dentro do caminho privado que a app cria (<uuid novo>-<uuid original>) → possível cópia pública", () => {
  assert.equal(estado({ despesa: [{ detalhe: { documento_url: `infracoes/${U2}-${U1}-avi.pdf` } }] }), "copia_publica");
});

test("o id só no caminho privado com o mesmo nome (script) → possível cópia pública", () => {
  assert.equal(estado({ despesa: [{ detalhe: { documento_url: `infracoes/${NOME}` } }] }), "copia_publica");
});

test("KYC em listas (doc_urls) e comprovativos → possível cópia pública", () => {
  assert.equal(estado({ motorista: [{ doc_urls: [`kyc/${U2}-${U1}-cc.jpg`, `kyc/${U3}-carta.jpg`] }] }), "copia_publica");
  assert.equal(estado({ pagamento: [{ comprovativo_url: `comprovativos/${U2}-${U1}-mbway.png` }] }), "copia_publica");
  assert.equal(estado({ motorista: [{ doc_urls: JSON.stringify([`kyc/${U2}-${U1}-cc.jpg`]) }] }), "copia_publica");
});

test("quarentena, link assinado para privado, JSON guardado em texto e barras escapadas → possível cópia pública", () => {
  assert.equal(estado({ registo: [{ nota: `privado/quarentena/${NOME}` }] }), "copia_publica");
  assert.equal(
    estado({
      comunicacao: [
        { texto: `Vê aqui: ${BASE}/storage/v1/object/sign/privado/infracoes/${U2}-${U1}-avi.pdf?token=abc.def` },
      ],
    }),
    "copia_publica",
  );
  assert.equal(
    estado({ despesa: [{ notas: JSON.stringify({ documento_url: `infracoes/${U2}-${U1}-avi.pdf` }) }] }),
    "copia_publica",
  );
  assert.equal(estado({ despesa: [{ notas: `{"documento_url":"infracoes\\/${U2}-${U1}-avi.pdf"}` }] }), "copia_publica");
});

test("em privado E num URL público → referenciado (o ficheiro público está em uso)", () => {
  assert.equal(
    estado({
      despesa: [{ detalhe: { documento_url: `infracoes/${U2}-${U1}-avi.pdf` } }],
      manutencao: [{ detalhe: { documento_url: publico(`faturas/${NOME}`) } }],
    }),
    "referenciado",
  );
  assert.equal(
    estado({
      despesa: [
        { detalhe: { documento_url: `infracoes/${U2}-${U1}-avi.pdf` } },
        { detalhe: { documento_url: `faturas/${NOME}` } },
      ],
    }),
    "referenciado",
  );
});

test("o nome novo de copiarParaFaturas é um URL público → referenciado (não entra na secção)", () => {
  assert.equal(estado({ manutencao: [{ detalhe: { documento_url: publico(`faturas/${U3}-${U1}-avi.pdf`) } }] }), "referenciado");
});

test("o id num sítio que não se reconhece (nome solto, texto, chave) → referenciado, não se alarma", () => {
  assert.equal(estado({ notificacao: [{ mensagem: `ficheiro ${NOME}` }] }), "referenciado");
  assert.equal(estado({ registo: [{ detalhe: { [U1]: true } }] }), "referenciado");
  assert.equal(
    estado({ despesa: [{ detalhe: { documento_url: `infracoes/${U2}-${U1}-avi.pdf`, nota: `ver ${U1}` } }] }),
    "referenciado",
  );
});

test("ondeEstaOcorrencia lê o que antecede o id", () => {
  assert.equal(ondeEstaOcorrencia("infracoes/"), "privado");
  assert.equal(ondeEstaOcorrencia(`kyc/${U2}-`), "privado");
  assert.equal(ondeEstaOcorrencia("comprovativos/"), "privado");
  assert.equal(ondeEstaOcorrencia("quarentena/"), "privado");
  assert.equal(ondeEstaOcorrencia("privado/infracoes/"), "privado");
  assert.equal(ondeEstaOcorrencia("/kyc/"), "privado");
  assert.equal(ondeEstaOcorrencia(`${BASE}/storage/v1/object/sign/privado/infracoes/`), "privado");
  assert.equal(ondeEstaOcorrencia(`${BASE}/storage/v1/object/public/motas/faturas/`), "publico");
  assert.equal(ondeEstaOcorrencia(`${BASE}/storage/v1/object/sign/motas/faturas/`), "publico");
  assert.equal(ondeEstaOcorrencia(`${BASE}/storage/v1/object/public/motas/`), "publico");
  assert.equal(ondeEstaOcorrencia("faturas/"), "publico");
  assert.equal(ondeEstaOcorrencia("motas/faturas/"), "publico");
  assert.equal(ondeEstaOcorrencia(""), "outro");
  assert.equal(ondeEstaOcorrencia("https://exemplo.pt/infracoes/"), "outro");
  assert.equal(ondeEstaOcorrencia("videos/"), "outro");
  assert.equal(ondeEstaOcorrencia("documento:infracoes/"), "outro");
});

test("soEmCaminhosPrivados precisa de pelo menos uma ocorrência", () => {
  assert.equal(soEmCaminhosPrivados(NOME, []), false);
  assert.equal(soEmCaminhosPrivados(NOME, [{ a: "nada" }]), false);
  assert.equal(soEmCaminhosPrivados(NOME, [[{ a: `kyc/${NOME}` }], null, 5, true]), true);
});

test("a secção nunca inclui órfãos, e os órfãos não mudam por causa dela", () => {
  const lidas = prepararTabelas(["despesa"], [[{ detalhe: { documento_url: `infracoes/${U2}-${U1}-avi.pdf` } }]]);
  const outro = `${U3}-fatura.pdf`;
  const { orfaos, copiasPublicas } = classificarFicheiros(
    [
      { name: NOME, id: "1" },
      { name: outro, id: "2" },
    ],
    lidas,
  );
  assert.deepEqual(
    orfaos.map((o) => o.name),
    [outro],
  );
  assert.deepEqual(
    copiasPublicas.map((o) => [o.name, o.refs]),
    [[NOME, ["despesa"]]],
  );
});
