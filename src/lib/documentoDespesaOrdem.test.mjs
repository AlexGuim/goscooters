// A ORDEM de passar o aviso de uma coima/portagem do bucket público para o privado
// (src/lib/documentoDespesa.ts), com um storage a fingir — sem rede.
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVISO_FICOU_NO_PUBLICO,
  avisoOriginalNoPublico,
  caminhoDaCopiaDeInfracao,
  infracaoParaPrivadoAoCarregar,
  infracaoParaPrivadoAoGravar,
  lerRefDocumento,
  textoFalhaAoCarregar,
} from "./documentoDespesa.ts";

const UUID_CARREGAMENTO = "0f1e2d3c-4b5a-4968-8776-655443322110";
const ORIGINAL = `faturas/${UUID_CARREGAMENTO}-aviso-portagem.pdf`;
const BYTES = 1234;

/** As falhas da cópia que o storage a fingir sabe simular. */
const FALHAS_DA_COPIA = {
  download: "o download falha",
  upload: "o upload falha a meio",
  truncada: "a cópia fica com outro tamanho",
  confirmarCopia: "não se consegue confirmar a cópia",
};

/** Todas as combinações (2^n) de um conjunto de falhas, da nenhuma a todas. */
const combinacoes = (falhas) => falhas.reduce((acc, f) => acc.flatMap((c) => [c, { ...c, [f]: true }]), [{}]);

/**
 * Storage a fingir: o original no público, as cópias no privado, e o registo das
 * operações pela ordem em que foram pedidas. `falhas` diz que passos falham.
 */
function storageFalso(falhas = {}) {
  const publico = new Map([[ORIGINAL, BYTES]]);
  const privado = new Map();
  const registo = [];
  let copias = 0;
  const op = {
    async copiar() {
      registo.push("copiar");
      if (falhas.download || !publico.has(ORIGINAL)) return { ok: false };
      const destino = `infracoes/copia-${++copias}.pdf`;
      if (falhas.upload) {
        privado.set(destino, 17); // o storage respondeu erro, mas ficou um bocado
        return { ok: false, destino };
      }
      privado.set(destino, falhas.truncada ? BYTES - 1 : BYTES);
      return { ok: true, destino, tamanho: BYTES };
    },
    async confirmarCopia(destino, tamanho) {
      registo.push("confirmarCopia");
      return !falhas.confirmarCopia && privado.get(destino) === tamanho;
    },
    async removerPublico() {
      registo.push("removerPublico");
      if (falhas.removerPublico) return false;
      publico.delete(ORIGINAL);
      return true;
    },
    async removerCopia(destino) {
      registo.push("removerCopia");
      privado.delete(destino);
    },
    async reapontarOutras() {
      registo.push("reapontarOutras");
      return !falhas.reapontarOutras;
    },
  };
  return { op, publico, privado, registo };
}

// ── Ao carregar (intake, importar fatura): falha fechado ────────────────────

test("ao carregar, tudo bem: copia, confirma, tira o público — e só então dá o caminho", async () => {
  const s = storageFalso();
  const r = await infracaoParaPrivadoAoCarregar(s.op);
  assert.deepEqual(s.registo, ["copiar", "confirmarCopia", "removerPublico"]);
  assert.equal(r.ok, true);
  assert.equal(s.publico.has(ORIGINAL), false);
  assert.equal(s.privado.get(r.caminho), BYTES);
});

test("ao carregar, o público que não sai nunca passa em silêncio: erro, sem caminho, e a cópia não fica", async () => {
  const s = storageFalso({ removerPublico: true });
  const r = await infracaoParaPrivadoAoCarregar(s.op);
  assert.deepEqual(r, { ok: false, publicoFicou: true });
  assert.equal(s.publico.has(ORIGINAL), true);
  assert.equal(s.privado.size, 0);
});

for (const [falha, descricao] of Object.entries(FALHAS_DA_COPIA)) {
  test(`ao carregar, ${descricao}: o público sai na mesma e não fica cópia`, async () => {
    const s = storageFalso({ [falha]: true });
    const r = await infracaoParaPrivadoAoCarregar(s.op);
    assert.deepEqual(r, { ok: false, publicoFicou: false });
    assert.equal(s.publico.has(ORIGINAL), false);
    assert.equal(s.privado.size, 0);
  });
}

test("ao carregar, a cópia falha E o público não sai: diz-se que ficou", async () => {
  const s = storageFalso({ upload: true, removerPublico: true });
  const r = await infracaoParaPrivadoAoCarregar(s.op);
  assert.deepEqual(r, { ok: false, publicoFicou: true });
  assert.equal(s.publico.has(ORIGINAL), true);
  assert.equal(s.privado.size, 0);
});

test("ao carregar, qualquer combinação de falhas: caminho só com o público vazio, e publicoFicou diz a verdade", async () => {
  for (const falhas of combinacoes([...Object.keys(FALHAS_DA_COPIA), "removerPublico"])) {
    const s = storageFalso(falhas);
    const r = await infracaoParaPrivadoAoCarregar(s.op);
    const caso = JSON.stringify(falhas);
    if (r.ok) {
      assert.equal(s.publico.has(ORIGINAL), false, caso);
      assert.deepEqual([...s.privado.keys()], [r.caminho], caso);
    } else {
      assert.equal(r.publicoFicou, s.publico.has(ORIGINAL), caso);
      assert.equal(s.privado.size, 0, caso);
    }
  }
});

// ── Ao gravar (editar, gravar a partir de fatura): a ordem do script ────────

test("ao gravar, a cópia fica confirmada ANTES de a linha ser gravada, e o público só sai no confirmar", async () => {
  const s = storageFalso();
  const r = await infracaoParaPrivadoAoGravar(s.op);
  assert.equal(r.ok, true);
  assert.deepEqual(s.registo, ["copiar", "confirmarCopia"]);
  assert.equal(s.publico.get(ORIGINAL), BYTES, "antes de a linha ser gravada, o original continua lá");
  assert.equal(s.privado.get(r.caminho), BYTES);
  // … aqui quem chama grava a linha …
  assert.equal(await r.confirmar(), null);
  assert.deepEqual(s.registo, ["copiar", "confirmarCopia", "reapontarOutras", "removerPublico"]);
  assert.equal(s.publico.has(ORIGINAL), false);
  assert.equal(s.privado.get(r.caminho), BYTES);
});

for (const [falha, descricao] of Object.entries(FALHAS_DA_COPIA)) {
  test(`ao gravar, ${descricao}: o público fica como estava (pode ser o único exemplar)`, async () => {
    const s = storageFalso({ [falha]: true });
    const r = await infracaoParaPrivadoAoGravar(s.op);
    assert.deepEqual(r, { ok: false });
    assert.equal(s.publico.get(ORIGINAL), BYTES);
    assert.equal(s.privado.size, 0);
    assert.equal(s.registo.includes("removerPublico"), false);
  });
}

test("ao gravar, a linha não ficou gravada: o desfazer tira só a cópia, o público fica", async () => {
  const s = storageFalso();
  const r = await infracaoParaPrivadoAoGravar(s.op);
  await r.desfazer();
  assert.equal(s.publico.get(ORIGINAL), BYTES);
  assert.equal(s.privado.size, 0);
  assert.equal(s.registo.includes("removerPublico"), false);
});

test("ao gravar, o público que não sai no confirmar diz-se — e a cópia, já gravada na linha, fica", async () => {
  const s = storageFalso({ removerPublico: true });
  const r = await infracaoParaPrivadoAoGravar(s.op);
  assert.equal(r.ok, true);
  assert.equal(await r.confirmar(), "remocao_falhou");
  assert.equal(s.publico.has(ORIGINAL), true);
  assert.equal(s.privado.get(r.caminho), BYTES);
});

test("ao gravar, outras linhas por passar para o caminho privado: o público não sai (partia-lhes o link), e diz-se", async () => {
  const s = storageFalso({ reapontarOutras: true });
  const r = await infracaoParaPrivadoAoGravar(s.op);
  assert.equal(await r.confirmar(), "outras_linhas");
  assert.equal(s.publico.get(ORIGINAL), BYTES);
  assert.equal(s.registo.includes("removerPublico"), false);
});

test("ao gravar, qualquer combinação de falhas, com a linha gravada ou não: o documento nunca fica sem exemplar", async () => {
  for (const falhas of combinacoes([...Object.keys(FALHAS_DA_COPIA), "removerPublico", "reapontarOutras"])) {
    for (const linhaGravada of [true, false]) {
      const s = storageFalso(falhas);
      const r = await infracaoParaPrivadoAoGravar(s.op);
      const caso = `${JSON.stringify(falhas)} linha ${linhaGravada ? "gravada" : "falhada"}`;
      // Antes de a linha ser gravada, o público está sempre lá.
      assert.equal(s.publico.get(ORIGINAL), BYTES, caso);
      assert.equal(s.registo.includes("removerPublico"), false, caso);
      if (!r.ok) {
        assert.equal(s.privado.size, 0, caso);
        continue;
      }
      if (linhaGravada) {
        const motivo = await r.confirmar();
        assert.equal(s.privado.get(r.caminho), BYTES, caso);
        assert.equal(motivo === null, !s.publico.has(ORIGINAL), caso);
      } else {
        await r.desfazer();
        assert.equal(s.publico.get(ORIGINAL), BYTES, caso);
        assert.equal(s.privado.size, 0, caso);
      }
    }
  }
});

// ── Nomes e mensagens ────────────────────────────────────────────────────────

test("caminhoDaCopiaDeInfracao: uuid novo, sem o uuid do carregamento, nome limpo e extensão mantida", () => {
  const U = "11111111-2222-4333-8444-555555555555";
  assert.equal(caminhoDaCopiaDeInfracao(ORIGINAL, U), `infracoes/${U}-aviso-portagem.pdf`);
  assert.equal(caminhoDaCopiaDeInfracao("faturas/Coima Março (2).PDF", U), `infracoes/${U}-coima-marco-2.pdf`);
  assert.equal(caminhoDaCopiaDeInfracao(`faturas/${UUID_CARREGAMENTO}-.jpg`, U), `infracoes/${U}-documento.jpg`);
  assert.equal(caminhoDaCopiaDeInfracao("faturas/sem-extensao", U), `infracoes/${U}-sem-extensao`);
  const longo = caminhoDaCopiaDeInfracao(`faturas/${"a-".repeat(30)}fim.png`, U);
  assert.match(longo, /^infracoes\/11111111-2222-4333-8444-555555555555-[a-z0-9-]{1,40}\.png$/);
  assert.equal(longo.includes("-.png"), false);
  for (const c of [ORIGINAL, "faturas/Coima Março (2).PDF", `faturas/${UUID_CARREGAMENTO}-.jpg`]) {
    const copia = caminhoDaCopiaDeInfracao(c, U);
    // A auditoria reconhece o original pelo uuid: a cópia não o pode levar.
    assert.equal(copia.includes(UUID_CARREGAMENTO), false, c);
    assert.deepEqual(lerRefDocumento(copia), { onde: "privado", caminho: copia }, c);
  }
});

test("o aviso de que ficou no público é o combinado", () => {
  assert.equal(AVISO_FICOU_NO_PUBLICO, 'ATENÇÃO: ficou no bucket público "motas" — apaga-o no Supabase.');
});

test("textoFalhaAoCarregar: o aviso só fica se o ficheiro ficou mesmo no público — e uma vez só", () => {
  const erro = "Não consegui guardar o documento da coima/portagem em privado — carrega-o outra vez.";
  const comAviso = `${erro} ${AVISO_FICOU_NO_PUBLICO}`;
  assert.equal(textoFalhaAoCarregar(comAviso, true), erro);
  assert.equal(textoFalhaAoCarregar(comAviso, false), comAviso);
  assert.equal(textoFalhaAoCarregar("Não consegui ler o documento.", false), `Não consegui ler o documento. ${AVISO_FICOU_NO_PUBLICO}`);
  assert.equal(textoFalhaAoCarregar("Não consegui ler o documento.", true), "Não consegui ler o documento.");
  assert.equal(textoFalhaAoCarregar("", false), AVISO_FICOU_NO_PUBLICO);
});

test("avisoOriginalNoPublico diz onde ficou e o que fazer", () => {
  const removido = avisoOriginalNoPublico(ORIGINAL, "remocao_falhou");
  const outras = avisoOriginalNoPublico(ORIGINAL, "outras_linhas");
  for (const a of [removido, outras]) {
    assert.ok(a.startsWith("ATENÇÃO:"), a);
    assert.ok(a.includes('"motas"') && a.includes(ORIGINAL), a);
  }
  assert.ok(removido.endsWith("apaga-o no Supabase."));
  assert.ok(outras.includes("outras linhas"));
});
