import { describe, it, expect } from 'vitest';
import { erroAmigavel, ehErroDuplicado } from './erroAmigavel';

describe('erroAmigavel', () => {
  it('traduz duplicado (23505) e personaliza para lead', async () => {
    const r = await erroAmigavel({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'adicionar lead');
    expect(r.titulo).toBe('Já existe');
    expect(r.descricao.toLowerCase()).toContain('lead');
  });

  it('traduz sessão expirada (JWT)', async () => {
    const r = await erroAmigavel({ message: 'JWT expired' });
    expect(r.titulo).toBe('Sessão expirada');
  });

  it('traduz sem conexão (Failed to fetch)', async () => {
    const r = await erroAmigavel(new TypeError('Failed to fetch'));
    expect(r.titulo).toBe('Sem conexão');
  });

  it('traduz sem permissão (RLS 42501)', async () => {
    const r = await erroAmigavel({ code: '42501', message: 'new row violates row-level security policy' });
    expect(r.titulo).toBe('Sem permissão');
  });

  it('traduz credenciais de login', async () => {
    const r = await erroAmigavel({ message: 'Invalid login credentials' });
    expect(r.titulo).toBe('Não foi possível entrar');
  });

  it('extrai e preserva mensagem PT de edge function (error.context Response)', async () => {
    const fakeFnError = {
      message: 'Edge Function returned a non-2xx status code',
      context: {
        status: 400,
        text: async () => JSON.stringify({ error: 'Conta Meta ativa nao encontrada. Reconecte a Meta em Configuracoes.' }),
      },
    };
    const r = await erroAmigavel(fakeFnError, 'buscar formularios');
    expect(r.descricao).toContain('Reconecte a Meta');
  });

  it('cai no genérico quando a mensagem é puramente técnica', async () => {
    const r = await erroAmigavel(new TypeError('x is not a function'));
    expect(r.titulo).toBe('Algo deu errado');
  });

  it('ehErroDuplicado detecta 23505', () => {
    expect(ehErroDuplicado({ code: '23505' })).toBe(true);
    expect(ehErroDuplicado({ message: 'something else' })).toBe(false);
  });
});
