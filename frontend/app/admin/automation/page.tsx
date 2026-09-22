'use client';

import { useState } from 'react';
import {
  Cpu,
  Plus,
  Play,
  Zap,
  Layers,
  Sparkles,
  Trash2,
  CheckCircle,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Rule {
  id: string;
  name: string;
  trigger: string;
  condition: string;
  action: string;
  active: boolean;
}

export default function AutomationWorkspace() {
  const [rules, setRules] = useState<Rule[]>([
    {
      id: '1',
      name: 'Auto-Generate PO on Low Stock',
      trigger: 'Stock falls below safety threshold',
      condition: 'Vendor is preferred & active',
      action: 'Create draft PO invoice in Purchases',
      active: true,
    },
    {
      id: '2',
      name: 'High-Value Invoice Owner Warning',
      trigger: 'B2B order total exceeds limit',
      condition: 'Total value > $5,000',
      action: 'Queue dispatch alert & notify Admin',
      active: true,
    },
    {
      id: '3',
      name: 'Overdue Collection Reminder',
      trigger: 'Invoice unpaid after terms',
      condition: 'Overdue > 15 days',
      action: 'Log WhatsApp alert (Mock) to Ledger',
      active: false,
    },
  ]);

  const [ruleName, setRuleName] = useState('');
  const [trigger, setTrigger] = useState('Stock falls below safety threshold');
  const [condition, setCondition] = useState('Total value > $5,000');
  const [action, setAction] = useState('Notify Admin');

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) {
      toast.error('Please enter a rule descriptive name');
      return;
    }
    const newRule: Rule = {
      id: Date.now().toString(),
      name: ruleName.trim(),
      trigger,
      condition,
      action,
      active: true,
    };
    setRules((prev) => [...prev, newRule]);
    setRuleName('');
    toast.success('Automation rule registered successfully!');
  };

  const deleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    toast.success('Rule deleted');
  };

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r))
    );
    toast.success('Rule status updated');
  };

  // iOS Glass design tokens
  const glassPanelClass = `bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.1)] rounded-2xl p-5`;
  const glassCardClass = `bg-slate-950/40 border border-white/[0.04] border-t-white/[0.12] rounded-xl p-4`;
  const glassButtonClass = `inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.08] hover:bg-white/[0.06] active:scale-[0.98] rounded-xl text-xs font-semibold text-white transition-all cursor-pointer`;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
          Workflow <span className="text-teal-400">Automation</span>
        </h1>
        <p className="text-slate-400 text-xs mt-1">Specify triggers, conditions, and actions for backend tasks.</p>
      </div>

      {/* Main split grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Left 2 Columns: Rule Builder Form */}
        <div className="lg:col-span-2 space-y-6">
          <div className={glassPanelClass}>
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400 animate-pulse" /> Add Rule Trigger
            </h3>

            <form onSubmit={handleAddRule} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Rule Descriptive Name</label>
                <input
                  type="text"
                  placeholder="e.g. Alert Admin on Gold Customer Invoice overdue"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">1. When (Trigger)</label>
                  <select
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="Stock falls below safety threshold">Product falls below safety stock</option>
                    <option value="B2B order total exceeds limit">POS order total exceeds limit</option>
                    <option value="Invoice unpaid after terms">Invoice unpaid after terms</option>
                    <option value="New B2B Account Created">New B2B Account Created</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">2. If (Condition)</label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="Total value > $5,000">Total value &gt; $5,000</option>
                    <option value="Vendor is preferred & active">Vendor is preferred &amp; active</option>
                    <option value="Overdue > 15 days">Overdue &gt; 15 days</option>
                    <option value="Account Level is Gold">Account Level is Gold</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">3. Then (Action)</label>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="Create draft PO invoice in Purchases">Create PO invoice</option>
                    <option value="Queue dispatch alert & notify Admin">Notify Admin (Log alert)</option>
                    <option value="Log WhatsApp alert (Mock) to Ledger">Send WhatsApp reminder (Mock)</option>
                    <option value="Freeze Customer Credit Accounts">Freeze Customer Credit limit</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  className="px-5 py-3 rounded-xl bg-gradient-to-tr from-teal-600 to-teal-500 text-xs font-bold text-white shadow-md shadow-teal-500/10 hover:from-teal-500 hover:to-teal-400 transition-all cursor-pointer"
                >
                  Create Rule Trigger
                </button>
              </div>
            </form>
          </div>

          {/* Active Rules List */}
          <div className={glassPanelClass}>
            <h3 className="text-sm font-bold text-white mb-4">Active Rule Workflows</h3>
            <div className="space-y-4">
              {rules.map((rule) => (
                <div key={rule.id} className="p-4 bg-slate-950/50 rounded-xl border border-white/5 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-bold text-white">{rule.name}</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">Rule ID: {rule.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleRule(rule.id)}
                        className={`text-[9px] font-bold px-2 py-0.5 rounded border transition-colors ${
                          rule.active
                            ? 'bg-teal-500/15 text-teal-400 border-teal-500/30'
                            : 'bg-slate-800 text-slate-500 border-slate-700'
                        }`}
                      >
                        {rule.active ? 'ACTIVE' : 'MUTED'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRule(rule.id)}
                        className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                        title="Delete Rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 block uppercase">Trigger</span>
                      <span className="font-semibold text-slate-300 block mt-0.5">{rule.trigger}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 block uppercase">Condition</span>
                      <span className="font-semibold text-slate-300 block mt-0.5">{rule.condition}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 block uppercase">Action Output</span>
                      <span className="font-bold text-teal-450 block mt-0.5">{rule.action}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 1 Column: Automation Help */}
        <div className={glassPanelClass}>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Automation Guide</h3>
          <div className="space-y-4 text-xs font-semibold text-slate-300">
            <div className="flex gap-2">
              <Zap className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-white font-bold">1. Event Triggers</p>
                <p className="text-slate-500 text-[10px]">Real-time hooks watching Mongo model updates (unpaid vouchers, stock numbers).</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Layers className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-white font-bold">2. Conditional Checks</p>
                <p className="text-slate-500 text-[10px]">Filters that prevent alert fatigue (e.g. only alarm when overdue limit exceeds credit thresholds).</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Cpu className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-white font-bold">3. Outputs & Actions</p>
                <p className="text-slate-550 text-[10px] italic">Currently mocked locally. If you register gateway credentials in settings, this builder routes alerts to outbound lines.</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
