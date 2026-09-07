'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BentoGrid, BentoGridItem } from '@/components/ui/bento-grid';
import {
  Layout,
  Cpu,
  Zap,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Layers,
  BrainCircuit,
  ShieldCheck,
  Code2,
  Sparkles,
  ChartArea,
  Target,
  Award,
  Boxes
} from 'lucide-react';
import { Cover } from "@/components/ui/cover";
import dynamic from 'next/dynamic';
import { getOrganizationSchema, getWebApplicationSchema } from '@/lib/structured-data';

const DemoEditor = dynamic(() => import('@/components/landing/DemoEditor'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] w-full border border-border rounded-xl bg-muted/20 animate-pulse flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <Layers className="w-8 h-8 text-muted-foreground animate-bounce" />
        <span className="text-xs text-muted-foreground font-medium">Loading interactive demo...</span>
      </div>
    </div>
  ),
});

export default function LandingPage() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.push('/problems');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (loading || isAuthenticated) {
    return (
      <div className="w-full h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground text-sm font-medium">Loading CapyNodes...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-primary/20 font-sans pt-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(getOrganizationSchema()),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(getWebApplicationSchema()),
        }}
      />
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-12 pb-20 md:pt-20 md:pb-40 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.05),transparent_1px)] bg-[length:32px_32px] pointer-events-none" />
          <div className="container mx-auto px-6 relative">
            <div className="max-w-4xl mx-auto text-center animate-reveal">
              <span className='justify-center flex mb-6'>
                <a href="https://www.producthunt.com/products/capynodes?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-capynodes" target="_blank" rel="noopener noreferrer"><img alt="CapyNodes - Build. Evaluate. Learn. AI System Design. | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1066561&amp;theme=light&amp;t=1769432775164" />
                </a>
              </span>
              <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-8 leading-[1.1] font-display">
                Build. Evaluate. Learn. <br />
                <div className="mt-2 mb-2 inline-block">
                  <Cover className="italic font-light tracking-tight mr-2 mb-2">AI System Design</Cover>
                </div>
              </h1>
              <p className="text-2xl text-muted-foreground mb-12 max-w-2xl mx-auto leading-relaxed font-medium md:text-balance">
                The platform that evaluates your AI system designs like LeetCode evaluates code.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
                <Button size="lg" className="rounded-full px-10 h-14 text-base font-bold shadow-2xl shadow-primary/20 transition-all hover:scale-105 active:scale-95 bg-primary text-primary-foreground hover:bg-primary/90 border-none" asChild>
                  <Link href="/register">
                    Start Designing for Free
                    <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Live Demo Editor */}
            <div className="mt-24 relative max-w-5xl mx-auto animate-reveal [animation-delay:200ms]">
              <div className="absolute -inset-8 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 rounded-[3rem] blur-3xl opacity-30" />
              <div className="hover-lift">
                <DemoEditor />
              </div>
            </div>
          </div>
        </section>

        {/* Platform Features Bento Grid */}
        <section id="features" className="py-32 bg-muted/20 border-y border-border/50">
          <div className="container mx-auto px-6">
            <div className="text-center mb-24">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 font-display tracking-tight">The Training Ground for AI Engineers</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto font-medium">
                Everything you need to design, evaluate, and perfect production-ready AI architectures.
              </p>
            </div>

            <BentoGrid className="max-w-7xl mx-auto">
              <BentoGridItem
                title="58+ Production-Grade Components"
                description="Specialized categories from Data Ingestion to ML Serving and Monitoring. Build architectures that reflect real-world complexity."
                header={
                  <div className="relative flex flex-1 w-full h-40 rounded-xl bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/10 p-4 overflow-hidden group-hover:border-blue-500/20 transition-colors">
                    <div className="absolute inset-0 flex items-center justify-center opacity-20">
                      <Boxes className="w-32 h-32 text-blue-500 rotate-12" />
                    </div>
                    <div className="relative grid grid-cols-4 gap-3 w-full">
                      {[...Array(8)].map((_, i) => (
                        <div key={i} className="flex flex-col gap-2">
                          <div className="h-2 bg-blue-500/30 rounded-full w-full" />
                          <div className="h-1.5 bg-blue-500/20 rounded-full w-2/3" />
                        </div>
                      ))}
                    </div>
                  </div>
                }
                icon={<Boxes className="h-4 w-4" />}
                className="md:col-span-2"
              />
              <BentoGridItem
                title="Hybrid Evaluation"
                description="Multi-stage validation combining lightning-fast rule checks with chain-of-thought analysis."
                header={
                  <div className="flex flex-1 w-full h-40 rounded-xl bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/10 p-4 flex-col justify-center gap-3 group-hover:border-amber-500/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 bg-amber-500/40 rounded-full" />
                      <span className="text-[10px] font-bold text-amber-500/70 uppercase">Rules</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 bg-amber-500/60 rounded-full" />
                      <span className="text-[10px] font-bold text-amber-500 uppercase">LLM</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 bg-amber-500/20 rounded-full" />
                      <span className="text-[10px] font-bold text-amber-500/40 uppercase">Final</span>
                    </div>
                  </div>
                }
                icon={<Zap className="h-4 w-4" />}
              />
              <BentoGridItem
                title="Real-World Scenarios"
                description="Curated library spanning RAG, recommendation engines, and high-scale production ML deployments."
                header={
                  <div className="flex flex-1 w-full h-40 rounded-xl bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent border border-purple-500/10 p-4 items-center justify-center group-hover:border-purple-500/20 transition-colors">
                    <div className="grid grid-cols-2 gap-4 w-full">
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
                        <Sparkles className="w-3 h-3 text-purple-500" />
                        <span className="text-[10px] text-purple-400 font-bold uppercase">RAG</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
                        <Target className="w-3 h-3 text-purple-500" />
                        <span className="text-[10px] text-purple-400 font-bold uppercase">Recs</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
                        <Zap className="w-3 h-3 text-purple-500" />
                        <span className="text-[10px] text-purple-400 font-bold uppercase">Live</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
                        <BarChart3 className="w-3 h-3 text-purple-500" />
                        <span className="text-[10px] text-purple-400 font-bold uppercase">Batch</span>
                      </div>
                    </div>
                  </div>
                }
                icon={<BrainCircuit className="h-4 w-4" />}
              />
              <BentoGridItem
                title="6 Evaluation Metrics"
                description="Deep analysis of Scalability, Performance, Cost, Reliability, Completeness, and Security."
                header={
                  <div className="flex flex-1 w-full h-40 rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10 p-4 flex-col justify-center gap-2 group-hover:border-primary/20 transition-colors">
                    {[
                      { label: 'Scale', width: '90%', color: 'bg-primary' },
                      { label: 'Cost', width: '70%', color: 'bg-primary/60' },
                      { label: 'Security', width: '85%', color: 'bg-primary/40' },
                    ].map((item, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex justify-between text-[8px] font-bold text-muted-foreground uppercase">
                          <span>{item.label}</span>
                          <span>{item.width}</span>
                        </div>
                        <div className="h-1.5 w-full bg-muted/20 rounded-full overflow-hidden">
                          <div className={`h-full ${item.color} rounded-full transition-all duration-1000`} style={{ width: item.width }} />
                        </div>
                      </div>
                    ))}
                  </div>
                }
                icon={<Award className="h-4 w-4" />}
              />
              <BentoGridItem
                title="Anti-Pattern Detection"
                description="Instantly identify single points of failure, missing redundancy, and over-engineering."
                header={
                  <div className="flex flex-1 w-full h-40 rounded-xl bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border border-rose-500/10 p-4 group-hover:border-rose-500/20 transition-colors">
                    <div className="flex flex-col gap-3 w-full justify-center">
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-rose-500/5 border border-rose-500/10">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">Redundancy OK</span>
                      </div>
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-rose-500/5 border border-rose-500/10">
                        <ShieldCheck className="w-4 h-4 text-rose-500" />
                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">SPoF Detected</span>
                      </div>
                    </div>
                  </div>
                }
                icon={<ShieldCheck className="h-4 w-4" />}
              />
              <BentoGridItem
                title="Skills Analytics"
                description="Track your progress across difficulty levels and identify architecture skill gaps over time."
                header={
                  <div className="flex flex-1 w-full h-40 rounded-xl bg-gradient-to-br from-green-500/10 via-green-500/5 to-transparent border border-green-500/10 p-4 items-center justify-center group-hover:border-green-500/20 transition-colors relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-green-500/20 via-transparent to-transparent opacity-20 pointer-events-none" />
                    <div className="relative z-10 p-4 rounded-2xl bg-green-500/10 border border-green-500/20 group-hover:scale-110 transition-transform duration-500">
                      <ChartArea className="w-12 h-12 text-green-500" />
                    </div>
                  </div>
                }
                icon={<ChartArea className="h-4 w-4" />}
              />
              <BentoGridItem
                title="High-Availability Evaluation"
                description="Our multi-layer fallback system ensures 99.9% uptime for evaluation, switching to intelligent lexical analysis if LLM capacity is reached."
                header={
                  <div className="relative flex flex-1 w-full h-40 rounded-xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/10 p-4 items-center justify-center overflow-hidden group-hover:border-emerald-500/20 transition-colors">
                    <div className="flex items-center gap-6 relative z-10">
                      <div className="flex flex-col items-center gap-2">
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                          <BrainCircuit className="w-6 h-6 text-emerald-500" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tighter">Primary</span>
                      </div>
                      <div className="h-px w-8 bg-emerald-500/30 relative">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                          <Code2 className="w-6 h-6 text-emerald-400" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tighter">Fallback</span>
                      </div>
                    </div>
                    <div className="absolute inset-0 opacity-[0.03]">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500 via-transparent to-transparent" />
                    </div>
                  </div>
                }
                icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
                className="md:col-span-2"
              />
            </BentoGrid>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 md:py-40 relative overflow-hidden bg-background">
          {/* Decorative Background Elements */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] opacity-20 pointer-events-none" />

          <div className="container mx-auto px-6 relative z-10">
            <div className="max-w-5xl mx-auto">
              <div className="bg-muted/30 backdrop-blur-xl border border-white/5 rounded-[3rem] p-8 md:p-24 text-center relative overflow-hidden group">
                {/* Inner Glow */}
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-colors duration-700" />
                <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-colors duration-700" />

                <div className="relative z-10 animate-reveal">
                  <h2 className="text-5xl md:text-7xl font-black mb-8 font-display tracking-tight leading-[1.1] bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground to-foreground/50">
                    Ready to ace your <br />
                    <span className="text-primary italic font-light">next interview?</span>
                  </h2>
                  <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto font-medium leading-relaxed">
                    Join the next generation of engineers in mastering the art of AI system design with production-grade architectures.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                    <Button size="lg" className="rounded-full px-12 h-16 text-lg font-bold shadow-2xl shadow-primary/30 transition-all hover:scale-105 active:scale-95 bg-primary text-primary-foreground hover:bg-primary/90 border-none group/btn" asChild>
                      <Link href="/register">
                        Get Started Now
                        <ArrowRight className="ml-2 w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="lg" className="rounded-full px-12 h-16 text-lg font-bold transition-all hover:bg-white/5 active:scale-95 border-white/10" asChild>
                      <Link href="/login">Sign in</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-20 border-t border-border/50">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-12">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center">
                <Image
                  src="/logo.png"
                  alt="CapyNodes"
                  width={32}
                  height={32}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="font-bold text-xl font-display tracking-tighter">CapyNodes</span>
            </div>
            <div className="text-sm font-medium text-muted-foreground">
              Built by:{' '}
              <a
                href="https://piyushchoudhari.me/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-foreground hover:text-primary transition-colors underline-offset-4 hover:underline"
              >
                Piyush Choudhari
              </a>
            </div>
            <div className="text-sm font-medium text-muted-foreground">
              © 2026 CapyNodes.
            </div>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .shimmer-button {
          background: linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--muted)) 50%, hsl(var(--primary)) 100%);
          background-size: 200% 100%;
          color: hsl(var(--primary-foreground));
          animation: shimmer 5s infinite linear;
        }
        .shimmer-button:hover {
          animation-duration: 2s;
        }
        .animate-reveal {
          animation: reveal 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
        @keyframes reveal {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
