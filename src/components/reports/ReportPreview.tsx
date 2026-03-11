import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye } from 'lucide-react';

interface ReportPreviewProps {
  message: string;
  isLoading?: boolean;
}

export function ReportPreview({ message, isLoading }: ReportPreviewProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Eye className="h-5 w-5" /> Preview</CardTitle></CardHeader>
        <CardContent><div className="animate-pulse space-y-2"><div className="h-4 bg-muted rounded w-3/4" /><div className="h-4 bg-muted rounded w-1/2" /><div className="h-4 bg-muted rounded w-2/3" /></div></CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Eye className="h-5 w-5" /> Preview da Mensagem
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg bg-[#0b141a] p-4 font-mono text-sm text-[#e9edef] whitespace-pre-wrap leading-relaxed">
          {message || 'Selecione um template para ver o preview'}
        </div>
      </CardContent>
    </Card>
  );
}
