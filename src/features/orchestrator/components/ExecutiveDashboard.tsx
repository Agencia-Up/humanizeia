import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, PieChart, Pie } from 'recharts';
import { useFluxCRM } from '@/hooks/useFluxCRM';
import { useOrchestrator } from '../hooks/useOrchestrator';
import { TrendingUp, Users, Target, Zap, DollarSign, ArrowUpRight } from 'lucide-react';

const data = [
  { name: 'Seg', execs: 12, leads: 5 },
  { name: 'Ter', execs: 18, leads: 8 },
  { name: 'Qua', execs: 15, leads: 12 },
  { name: 'Qui', execs: 22, leads: 10 },
  { name: 'Sex', execs: 30, leads: 15 },
  { name: 'Sab', execs: 25, leads: 7 },
  { name: 'Dom', execs: 10, leads: 3 },
];

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088FE', '#00C49F'];

const ExecutiveDashboard = () => {
  const { leads, stages, totalValue } = useFluxCRM();
  const { activeTasks } = useOrchestrator();

  const funnelData = stages.map((stage, idx) => ({
    name: stage.name,
    value: leads.filter(l => l.stage_id === stage.id).length,
    fill: COLORS[idx % COLORS.length]
  }));

  const wonLeads = leads.filter(l => l.won_at);
  const conversionRate = leads.length > 0 ? ((wonLeads.length / leads.length) * 100).toFixed(1) : 0;

  return (
    <div className="space-y-6">
      {/* Top row KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-black/40 border-white/5 overflow-hidden group">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Taxa de Conversão</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{conversionRate}%</div>
            <div className="flex items-center text-[10px] text-green-500 mt-1 uppercase font-bold">
                <ArrowUpRight className="w-3 h-3 mr-1" /> +12% vs last month
            </div>
          </CardContent>
        </Card>

        <Card className="bg-black/40 border-white/5 overflow-hidden group">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Valor do Pipeline</CardTitle>
            <DollarSign className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
                {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 uppercase font-mono italic">Leads Ativos: {leads.length}</p>
          </CardContent>
        </Card>

        <Card className="bg-black/40 border-white/5 overflow-hidden group">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Meta Mensal</CardTitle>
            <Target className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">74%</div>
            <div className="w-full bg-white/5 h-1.5 rounded-full mt-2">
                <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: '74%' }} />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-black/40 border-white/5 overflow-hidden group">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Eficiência Salomão</CardTitle>
            <Zap className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">98.2%</div>
            <p className="text-[10px] text-muted-foreground mt-1 uppercase font-mono italic">Uptime dos Agentes</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        {/* Main Activity Chart */}
        <Card className="lg:col-span-4 bg-black/40 border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-white">Atividade da Orquestração (7 Dias)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="colorExecs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8884d8" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" />
                  <XAxis dataKey="name" stroke="#666" fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#666" fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#000', border: '1px solid #333', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '10px' }}
                  />
                  <Area type="monotone" dataKey="execs" stroke="#8884d8" fillOpacity={1} fill="url(#colorExecs)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Funnel Chart */}
        <Card className="lg:col-span-3 bg-black/40 border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-white">Funil de Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" stroke="#fff" fontSize={9} width={80} />
                  <Tooltip
                    cursor={{ fill: '#ffffff05' }}
                    contentStyle={{ backgroundColor: '#000', border: '1px solid #333' }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {funnelData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ExecutiveDashboard;
