import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, User as UserIcon, Building } from 'lucide-react';

interface UserProfile {
  id: string;
  full_name: string | null;
  email?: string;
  is_superadmin: boolean;
  organization_id: string | null;
  created_at: string;
}

export function AdminSettingsTab() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    // Buscamos perfis e tentamos cruzar com auth.users se possível, 
    // mas por segurança via RLS configurado, superadmin vê a tabela profiles inteira.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar usuários:', error);
    } else {
      setUsers(data as unknown as UserProfile[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-black/40 backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-yellow-500" />
                Painel Administrativo
              </CardTitle>
              <CardDescription>
                Gestão global de usuários e acessos da plataforma Logos IA.
              </CardDescription>
            </div>
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
              Acesso Master
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Organização</TableHead>
                <TableHead>Data de Cadastro</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {user.full_name || 'Usuário sem nome'}
                      </span>
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                        ID: {user.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.is_superadmin ? (
                      <Badge className="bg-yellow-600 hover:bg-yellow-700">
                        SuperAdmin
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        Usuário
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm">
                        {user.organization_id ? 'Vinculado' : 'Sem Org'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    --
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhum usuário encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground bg-muted/20 p-4 rounded-lg border border-dashed text-center italic">
        <p>Aba de Logs e Auditoria virá em breve.</p>
        <p>Gestão de Planos e Tokens em desenvolvimento.</p>
      </div>
    </div>
  );
}
