-- ============================================================================
-- F1b — Aperta a RLS das tabelas de sincronizacao UAZAPI.
--
-- MOTIVO (achado em teste com dois tenants, 29/07): a policy original liberava
-- leitura a QUALQUER membro ativo do tenant. Um vendedor comum lia a tabela crua
-- e veria, pela API, todas as conversas da empresa — inclusive de leads de outros
-- vendedores —, contrariando a regra do projeto (o vendedor so enxerga o que lhe
-- foi atribuido). As RPCs SECURITY DEFINER ja respeitam a regra; a tabela nao.
--
-- ADITIVO e reversivel: nao altera migration ja aplicada, nao toca dados. Apenas
-- substitui as tres policies de SELECT por uma versao estritamente MAIS restrita.
--
-- Quem le a tabela crua depois desta migration:
--   * dono da conta (tenant_id = auth.uid());
--   * superadmin;
--   * gerente ATIVO e NAO removido do tenant.
-- Negados: vendedor comum, gerente inativo/removido, anonimo e qualquer usuario
-- de outro tenant. O vendedor comum continua acessando pelas RPCs, que filtram
-- por atribuicao.
--
-- Escrita: segue exclusivamente do service_role (o syncer), que nao passa por RLS.
-- Nenhuma policy de INSERT/UPDATE/DELETE existe — usuario autenticado nunca escreve.
-- ============================================================================

do $$
declare
  t   text;
  pol text;
begin
  foreach t in array array['wa_sync_checkpoint','wa_sync_run','wa_synced_messages'] loop
    pol := t || '_sel';
    execute format('drop policy if exists %I on public.%I', pol, t);
    execute format($f$
      create policy %I on public.%I for select to authenticated using (
        tenant_id = auth.uid()
        or coalesce(public.is_current_user_superadmin(), false)
        or exists (
          select 1 from public.ai_team_members m
          where m.auth_user_id = auth.uid()
            and m.user_id = %I.tenant_id
            and coalesce(m.is_manager, false)
            and m.removed_at is null
            and coalesce(m.active_in_system, true) <> false
        )
      )$f$, pol, t, t);
  end loop;
end $$;

comment on table public.wa_synced_messages is
  'Historico importado da caixa UAZAPI (read-only). Tabela DEDICADA: nenhum webhook/trigger/worker a le -> mensagem sincronizada nunca vira mensagem nova nem entra na fila do V3. Idempotencia por (tenant_id, instance_id, provider_message_id). Leitura direta: dono/superadmin/gerente ativo; vendedor comum SO pelas RPCs (filtradas por atribuicao).';
