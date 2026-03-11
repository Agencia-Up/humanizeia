import { Check, Globe, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  name: string;
  currency?: string;
  timezone_name?: string;
}

interface AccountSelectorProps {
  accounts: Account[];
  selectedId: string | null;
  onSelect: (account: Account) => void;
  emptyMessage?: string;
}

export function AccountSelector({ accounts, selectedId, onSelect, emptyMessage }: AccountSelectorProps) {
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
        <span className="text-3xl">🔍</span>
        <p className="text-sm text-muted-foreground">
          {emptyMessage || 'Nenhuma conta encontrada'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((account) => {
        const isSelected = selectedId === account.id;
        return (
          <button
            key={account.id}
            onClick={() => onSelect(account)}
            className={cn(
              'flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all duration-200',
              isSelected
                ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                : 'border-border hover:border-primary/40 hover:bg-muted/50',
            )}
          >
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {isSelected ? <Check className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium text-foreground">{account.name}</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {account.currency && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    {account.currency}
                  </span>
                )}
                {account.timezone_name && (
                  <span className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {account.timezone_name}
                  </span>
                )}
              </div>
            </div>
            {isSelected && <span className="text-lg">✅</span>}
          </button>
        );
      })}
    </div>
  );
}
