'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, PublicUserProfile, Analytics } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProfileSkeleton } from '@/components/ui/profile-skeleton';
import { Edit, Linkedin, Twitter, Github, Globe, LogOut, AlertTriangle, Trophy } from 'lucide-react';
import EditProfileModal from '@/components/profile/EditProfileModal';
import { Pie, PieChart, Cell, ResponsiveContainer, Label } from 'recharts';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  ScoreTrendChart,
  DimensionRadarChart,
  ComponentUsage,
} from '@/components/analytics';

export default function PublicProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;
  const { user, logout, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const fetchData = async () => {
    setError(null);
    setLoading(true);
    try {
      const [profileData, analyticsData] = await Promise.all([
        apiClient.getPublicProfile(username),
        apiClient.getPublicAnalytics(username),
      ]);
      setProfile(profileData);
      setAnalytics(analyticsData);
    } catch (err) {
      console.error('Failed to fetch profile data:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (username && !authLoading) {
      fetchData();
    }
  }, [username, authLoading]);

  const handleProfileUpdate = () => {
    setIsEditModalOpen(false);
    fetchData();
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (err) {
      console.error('Logout failed:', err);
      setIsLoggingOut(false);
    }
  };

  if (loading) {
    return <ProfileSkeleton />;
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6 pt-24">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <h2 className="text-2xl font-bold">Profile Not Found</h2>
          <p className="text-muted-foreground">
            {error || 'The user you are looking for does not exist.'}
          </p>
        </Card>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty.toLowerCase()) {
      case 'beginner':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'intermediate':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'advanced':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');

  return (
    <div className="min-h-screen bg-background p-6 pt-24">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-3">
              <h1 className="text-4xl md:text-5xl font-bold font-display tracking-tight leading-[1.1]">
                {profile.username}
              </h1>
              {profile.is_owner && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setIsEditModalOpen(true)}
                    className="flex items-center gap-2 flex-1 sm:flex-none justify-center"
                    disabled={isLoggingOut}
                  >
                    <Edit size={18} />
                    <span>Edit Profile</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="flex items-center gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20 disabled:opacity-50 flex-1 sm:flex-none justify-center"
                  >
                    {isLoggingOut ? (
                      <>
                        <div className="w-[18px] h-[18px] border-2 border-destructive/30 border-t-destructive rounded-full animate-spin" />
                        <span>Logging out...</span>
                      </>
                    ) : (
                      <>
                        <LogOut size={18} />
                        <span>Logout</span>
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
            {fullName && (
              <p className="text-xl text-muted-foreground font-medium mb-3">{fullName}</p>
            )}
            {profile.bio && (
              <p className="text-body text-foreground/80 max-w-3xl mb-4">{profile.bio}</p>
            )}
            {(profile.linkedin_url || profile.twitter_url || profile.github_url || profile.website_url) && (
              <div className="flex flex-wrap items-center gap-4 mt-4">
                {profile.linkedin_url && (
                  <a
                    href={profile.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title="LinkedIn"
                  >
                    <Linkedin size={24} />
                  </a>
                )}
                {profile.twitter_url && (
                  <a
                    href={profile.twitter_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title="X (Twitter)"
                  >
                    <Twitter size={24} />
                  </a>
                )}
                {profile.github_url && (
                  <a
                    href={profile.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title="GitHub"
                  >
                    <Github size={24} />
                  </a>
                )}
                {profile.website_url && (
                  <a
                    href={profile.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title="Website"
                  >
                    <Globe size={24} />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-6">
            <div className="text-center space-y-2">
              <p className="text-caption normal-case tracking-normal text-muted-foreground font-semibold">Total Score</p>
              <p className="text-display text-primary">{analytics.total_score}</p>
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-center space-y-2">
              <p className="text-caption normal-case tracking-normal text-muted-foreground font-semibold">Problems Attempted</p>
              <p className="text-display text-blue-600">{analytics.problems_attempted}</p>
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-center space-y-2">
              <p className="text-caption normal-case tracking-normal text-muted-foreground font-semibold">Problems Solved</p>
              <p className="text-display text-green-600">{analytics.problems_solved}</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Score &gt; 70 required</p>
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-center space-y-2">
              <p className="text-caption normal-case tracking-normal text-muted-foreground font-semibold">Average Score</p>
              <p className="text-display text-orange-600">
                {analytics.average_score.toFixed(1)}
              </p>
            </div>
          </Card>
        </div>

        {/* NEW: Score Trend & Dimension Radar Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {analytics.score_trends?.weekly && analytics.score_trends.weekly.length > 0 && (
            <ScoreTrendChart data={analytics.score_trends.weekly} />
          )}
          {analytics.dimension_stats && (
            <DimensionRadarChart data={analytics.dimension_stats} />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6 flex flex-col">
            <h2 className="text-heading mb-4">Difficulty Breakdown</h2>
            <div className="flex-1 flex flex-col items-center justify-center">
              <ChartContainer
                config={{
                  solved: { label: "Solved" },
                  beginner: { label: "Beginner", color: "#22c55e" },
                  intermediate: { label: "Intermediate", color: "#eab308" },
                  advanced: { label: "Advanced", color: "#ef4444" },
                } satisfies ChartConfig}
                className="mx-auto aspect-square max-h-[250px] w-full"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={Object.entries(analytics.difficulty_stats).map(([difficulty, stats]) => ({
                      difficulty,
                      solved: stats.solved,
                      fill: difficulty === 'beginner' ? '#22c55e' : difficulty === 'intermediate' ? '#eab308' : '#ef4444',
                    }))}
                    dataKey="solved"
                    nameKey="difficulty"
                    innerRadius={60}
                    strokeWidth={5}
                  >
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          return (
                            <text
                              x={viewBox.cx}
                              y={viewBox.cy}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              <tspan
                                x={viewBox.cx}
                                y={viewBox.cy}
                                className="fill-foreground text-3xl font-bold"
                              >
                                {analytics.problems_solved}
                              </tspan>
                              <tspan
                                x={viewBox.cx}
                                y={(viewBox.cy || 0) + 24}
                                className="fill-muted-foreground"
                              >
                                Solved
                              </tspan>
                            </text>
                          )
                        }
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="flex flex-wrap justify-center gap-4 mt-4">
                {Object.entries(analytics.difficulty_stats).map(([difficulty, stats]) => (
                  <div key={difficulty} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: difficulty === 'beginner' ? '#22c55e' : difficulty === 'intermediate' ? '#eab308' : '#ef4444' }}
                    />
                    <span className="text-sm font-medium capitalize">{difficulty}</span>
                    <span className="text-sm text-muted-foreground">({stats.solved})</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-heading mb-4">Category Stats</h2>
            <div className="space-y-3">
              {Object.entries(analytics.category_stats).map(([category, stats]) => (
                <div key={category} className="flex items-center justify-between p-3 bg-muted/50 rounded">
                  <div>
                    <p className="text-body font-semibold">{category}</p>
                    <p className="text-small text-muted-foreground">
                      {stats.solved} problems
                    </p>
                  </div>
                  <Badge variant="outline" className="text-small font-bold">{stats.avg_score.toFixed(1)}</Badge>
                </div>
              ))}
              {Object.keys(analytics.category_stats).length === 0 && (
                <p className="text-body text-muted-foreground text-center py-4">
                  No submissions yet
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* NEW: Component Usage */}
        <div className="grid grid-cols-1 gap-6">
          {analytics.component_usage && (
            <ComponentUsage data={analytics.component_usage} />
          )}
        </div>

        <Card className="p-6">
          <h2 className="text-heading mb-4">Recent Submissions</h2>
          <div className="space-y-2">
            {analytics.recent_submissions.length > 0 ? (
              <div className="space-y-2">
                {analytics.recent_submissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors gap-4"
                  >
                    <div className="flex-1">
                      <p className="text-body font-semibold">{submission.question__title}</p>
                      <p className="text-small text-muted-foreground">
                        {new Date(submission.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">
                      <Badge className={getDifficultyColor(submission.question__difficulty)}>
                        {submission.question__difficulty}
                      </Badge>
                      <div className="text-right">
                        <p className="text-caption normal-case tracking-normal text-muted-foreground font-semibold">Score</p>
                        <p className="text-subheading font-bold">{submission.score}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-body text-muted-foreground text-center py-8">
                No submissions yet. Start solving problems to see your progress!
              </p>
            )}
          </div>
        </Card>

        {profile.is_owner && (
          <div className="mt-6 pt-6 border-t border-destructive/20">
            <Card className="border-destructive/20 bg-destructive/5">
              <div className="p-6">
                <div className="flex items-center gap-2 text-destructive mb-2">
                  <AlertTriangle size={20} />
                  <h3 className="text-lg font-bold">Danger Zone</h3>
                </div>
                <p className="text-muted-foreground mb-4">
                  Once you delete your account, there is no going back. Please be certain.
                </p>
                <Button
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive hover:text-destructive-foreground transition-all"
                  onClick={() => router.push('/account/delete')}
                >
                  Delete Account
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {profile.is_owner && (
        <EditProfileModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={handleProfileUpdate}
          currentProfile={{
            first_name: profile.first_name,
            last_name: profile.last_name,
            bio: profile.bio || '',
            linkedin_url: profile.linkedin_url || '',
            twitter_url: profile.twitter_url || '',
            github_url: profile.github_url || '',
            website_url: profile.website_url || '',
          }}
        />
      )}
    </div>
  );
}

