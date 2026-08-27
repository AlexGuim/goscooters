#!/usr/bin/env node
/**
 * Corre um ficheiro .sql no Postgres do Supabase (as migrações de sql/).
 *
 * Existe porque as chaves da API (anon/service_role) falam com o PostgREST, que
 * lê e escreve DADOS mas não executa DDL — criar tabelas ou ativar RLS exige
 * ligação direta ao Postgres.
 *
 * Ao contrário do `supabase db push` (que gere um histórico de migrações), este
 * corre UM ficheiro à escolha: é a convenção deste projeto, onde as migrações
 * são `sql/faseN.sql` aplicadas quando é preciso.
 *
 * Tudo dentro de UMA transação: se qualquer instrução falhar, nada fica
 * aplicado. Meia-migração é pior do que nenhuma.
 *
 * Uso:
 *   npm run sql -- sql/fase11_comprovativo_pagamento.sql
 *   npm run sql -- --dry-run sql/fase11_comprovativo_pagamento.sql
 *   npm run sql -- --consulta "select count(*) from pagamento"
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const RAIZ = path.resolve(import.meta.dirname, "..");

function carregarEnv() {
  const f = path.join(RAIZ, ".env.local");
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

const env = carregarEnv();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const iConsulta = args.indexOf("--consulta");
const consulta = iConsulta >= 0 ? args[iConsulta + 1] : null;
const ficheiros = args.filter((a) => a.endsWith(".sql"));

const ligacao = env.SUPABASE_DB_URL;
if (!ligacao) {
  console.error(
    [
      "Falta SUPABASE_DB_URL no .env.local.",
      "",
      "No Supabase: Settings → Database → Connection string → escolhe «Session pooler»",
      "e copia o URI, substituindo [YOUR-PASSWORD] pela password da base de dados.",
      "",
      'Depois acrescenta ao .env.local (entre aspas, porque a password pode ter símbolos):',
      '  SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-X-<regiao>.pooler.supabase.com:5432/postgres"',
      "",
      "Usa o SESSION pooler (porta 5432). O modo «transaction» (6543) não serve para DDL.",
    ].join("\n"),
  );
  process.exit(1);
}

if (!ficheiros.length && !consulta) {
  console.error("Indica um ficheiro .sql ou --consulta \"<sql>\".");
  process.exit(1);
}

// O pooler do Supabase exige TLS, mas apresenta um certificado que a cadeia
// local não valida — daí `rejectUnauthorized: false` (a ligação continua cifrada).
const cliente = new pg.Client({ connectionString: ligacao, ssl: { rejectUnauthorized: false } });

const anonimo = (s) => s.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:••••@");

try {
  console.log(`→ ${anonimo(ligacao)}`);
  await cliente.connect();
  const { rows: quem } = await cliente.query(
    "select current_database() as bd, current_user as utilizador",
  );
  console.log(`✓ ligado a ${quem[0].bd} como ${quem[0].utilizador}\n`);

  if (consulta) {
    const r = await cliente.query(consulta);
    console.table(r.rows);
  } else {
    for (const rel of ficheiros) {
      const abs = path.resolve(RAIZ, rel);
      if (!fs.existsSync(abs)) {
        console.error(`✗ não existe: ${rel}`);
        process.exitCode = 1;
        continue;
      }
      const sql = fs.readFileSync(abs, "utf8");
      if (dryRun) {
        const instrucoes = sql
          .split("\n")
          .filter((l) => /^\s*(create|alter|comment|drop|insert|update|grant|revoke)/i.test(l));
        console.log(`— ${rel} (dry-run, ${instrucoes.length} instruções):`);
        instrucoes.forEach((l) => console.log(`    ${l.trim()}`));
        continue;
      }
      process.stdout.write(`— ${rel} … `);
      // Transação: ou aplica tudo, ou não aplica nada.
      await cliente.query("begin");
      try {
        await cliente.query(sql);
        await cliente.query("commit");
        console.log("✓ aplicado");
      } catch (e) {
        await cliente.query("rollback");
        console.log("✗ FALHOU (nada foi aplicado)");
        console.error(`   ${e.message}`);
        if (e.hint) console.error(`   sugestão: ${e.hint}`);
        process.exitCode = 1;
      }
    }
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await cliente.end().catch(() => {});
}
