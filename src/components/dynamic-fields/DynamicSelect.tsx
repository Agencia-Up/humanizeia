// Fase 6.4a — Select com busca (Command/Popover) + opção "Adicionar nova"
// Substitui o Select simples por Combobox shadcn pra suportar typeahead.

import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus, Check } from "lucide-react";
import { useDynamicFields } from "@/hooks/useDynamicFields";
import { AddDynamicModal } from "./AddDynamicModal";
import type { DynamicEntity, DynamicRow } from "@/services/dynamicFields/dynamicFieldsService";
import { cn } from "@/lib/utils";

interface Props {
  entity: DynamicEntity;
  userId: string | null | undefined;
  value: string | null; // id da row
  onChange: (id: string | null, row: DynamicRow | null) => void;
  placeholder?: string;
  allowCreate?: boolean;
  filter?: (row: DynamicRow) => boolean;
  triggerClassName?: string;
  disabled?: boolean;
}

export function DynamicSelect({
  entity,
  userId,
  value,
  onChange,
  placeholder,
  allowCreate = true,
  filter,
  triggerClassName,
  disabled,
}: Props) {
  const { rows, loading, reload } = useDynamicFields(entity, userId);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!filter) return rows;
    return rows.filter(filter);
  }, [rows, filter]);

  const selected = useMemo(() => filtered.find((r) => r.id === value) || null, [filtered, value]);

  const handleSelect = (row: DynamicRow) => {
    onChange(row.id, row);
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null, null);
    setOpen(false);
  };

  const handleCreated = async (row: DynamicRow) => {
    await reload();
    onChange(row.id, row);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || !userId}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              triggerClassName
            )}
          >
            <span className="flex items-center gap-1.5 truncate">
              {selected ? (
                <>
                  {(selected as any).icon && <span>{(selected as any).icon}</span>}
                  <span className="truncate">{selected.name}</span>
                </>
              ) : (
                loading ? "Carregando..." : (placeholder || "Selecione...")
              )}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[240px]" align="start">
          <Command>
            <CommandInput placeholder="Buscar..." className="h-9" />
            <CommandList>
              <CommandEmpty>
                {loading ? "Carregando..." : "Nenhum resultado encontrado."}
              </CommandEmpty>
              {filtered.length > 0 && (
                <CommandGroup>
                  {filtered.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.name + " " + r.normalized_name}
                      onSelect={() => handleSelect(r)}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === r.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {(r as any).icon && <span className="mr-1">{(r as any).icon}</span>}
                      <span className="flex-1 truncate">{r.name}</span>
                      {r.is_system_default && (
                        <span className="text-[9px] text-muted-foreground ml-2">padrão</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {value && (
                <CommandGroup>
                  <CommandItem
                    value="__clear__"
                    onSelect={handleClear}
                    className="cursor-pointer text-muted-foreground italic"
                  >
                    — Limpar seleção —
                  </CommandItem>
                </CommandGroup>
              )}
              {allowCreate && userId && (
                <CommandGroup>
                  <CommandItem
                    value="__add_new__"
                    onSelect={() => {
                      setOpen(false);
                      setModalOpen(true);
                    }}
                    className="cursor-pointer text-primary font-medium"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar novo(a)
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {userId && (
        <AddDynamicModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          entity={entity}
          userId={userId}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
