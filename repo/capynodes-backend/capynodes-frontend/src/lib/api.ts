const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  email_verified: boolean;
  has_password: boolean;
  onboarding_completed: boolean;
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  github_url: string | null;
  website_url: string | null;
  total_score: number;
  problems_solved: number;
  created_at: string;
  updated_at: string;
}

export interface PublicUserProfile {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  github_url: string | null;
  website_url: string | null;
  total_score: number;
  problems_solved: number;
  created_at: string;
  updated_at: string;
  is_owner: boolean;
}

export interface Question {
  id: number;
  title: string;
  description: string;
  constraints: Record<string, any>;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  category: string;
  ideal_solution: any;
  created_at: string;
}

export interface Submission {
  id: number;
  question: number;
  question_title: string;
  question_difficulty: string;
  username: string;
  diagram: {
    nodes: any[];
    edges: any[];
  };
  evaluation_result: any;
  score: number;
  created_at: string;
}

export interface Analytics {
  total_score: number;
  problems_solved: number;
  problems_attempted: number;
  total_submissions: number;
  average_score: number;
  difficulty_stats: {
    [key: string]: {
      solved: number;
      avg_score: number;
      attempts: number;
    };
  };
  category_stats: {
    [key: string]: {
      solved: number;
      avg_score: number;
    };
  };
  recent_submissions: Array<{
    id: number;
    question__title: string;
    score: number;
    created_at: string;
    question__difficulty: string;
  }>;
  // Dimension stats
  dimension_stats?: {
    [key: string]: {
      avg_score: number;
    };
  };
  // Score trends over time
  score_trends?: {
    weekly: Array<{
      week: string;
      avg_score: number;
      submissions: number;
    }>;
    difficulty_progress: {
      [key: string]: {
        current_avg: number;
      };
    };
  };
  // Component usage patterns
  component_usage?: {
    most_used?: Array<{
      name: string;
      count: number;
      percentage: number;
    }>;
    total_components?: number;
    unique_components?: number;
  };
  // Improvement summary
  improvement_summary?: {
    recurring_issues?: Array<{ theme: string; count: number }>;
    recurring_strengths?: Array<{ theme: string; count: number }>;
    suggested_focus?: {
      dimension: string;
      avg_score: number;
      reason: string;
    } | null;
  };
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface CreditStatus {
  credits_remaining: number;
  max_credits: number;
  reset_at: string | null;
  seconds_until_reset: number | null;
  total_lifetime_used: number;
}

export interface EvaluationResult {
  overallScore: number;
  breakdown: Array<{
    category: string;
    score: number;
    weight: number;
    explanation: string;
  }>;
  strengths: string[];
  improvements: string[];
  credits?: CreditStatus;
}

export interface CustomNodeDefinition {
  id: number;
  type: string;
  label: string;
  category: string;
  icon_name: string;
  description: string;
  tooltip: string;
  properties: any[];
  inputs: number;
  outputs: number;
  created_at: string;
  updated_at: string;
}


export interface EvaluationError {
  error: string;
  credits?: CreditStatus;
  message?: string;
}

export interface FollowUpQuestionsResponse {
  questions: string[];
  credits?: CreditStatus;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor() {
    // Access token is only in memory
  }

  setToken(token: string | null) {
    this.accessToken = token;
  }

  getToken() {
    return this.accessToken;
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        console.log("Attempting to refresh access token using cookie...");
        const response = await fetch(`${API_URL}/auth/token/refresh/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          console.log("Access token refreshed successfully.");
          this.accessToken = data.access;
          return this.accessToken;
        }
        
        console.warn(`Access token refresh failed with status: ${response.status}`);
        // If refresh fails, clear token
        this.accessToken = null;
        return null;
      } catch (error) {
        console.error("Error during access token refresh:", error);
        this.accessToken = null;
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: "include",
    });

    // If 401, try to refresh once
    if (response.status === 401 && endpoint !== "/auth/login/" && endpoint !== "/auth/token/refresh/") {
      const newToken = await this.refreshAccessToken();
      if (newToken) {
        headers["Authorization"] = `Bearer ${newToken}`;
        response = await fetch(`${API_URL}${endpoint}`, {
          ...options,
          headers,
          credentials: "include",
        });
      }
    }

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => null);
      
      let errorMessage = errorData?.error || errorData?.detail || errorData?.message;
      
      if (!errorMessage && errorData && typeof errorData === 'object') {
        const fieldErrors: string[] = [];
        for (const [field, errors] of Object.entries(errorData)) {
          if (Array.isArray(errors)) {
            fieldErrors.push(`${field}: ${errors.join(', ')}`);
          } else if (typeof errors === 'string') {
            fieldErrors.push(`${field}: ${errors}`);
          }
        }
        
        if (fieldErrors.length > 0) {
          errorMessage = fieldErrors.join('; ');
        }
      }
      
      if (!errorMessage) {
        errorMessage = `HTTP error! status: ${response.status}`;
      }
      
      const error: any = new Error(errorMessage);
      error.statusCode = response.status;
      error.fieldErrors = errorData;
      throw error;
    }

    return response.json();
  }

  async register(data: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
    first_name?: string;
    last_name?: string;
  }) {
    const response = await this.request("/auth/register/", {
      method: "POST",
      body: JSON.stringify(data),
    });
    this.setToken(response.access);
    return response;
  }

  async login(usernameOrEmail: string, password: string) {
    const response = await this.request("/auth/login/", {
      method: "POST",
      body: JSON.stringify({ username: usernameOrEmail, password }),
    });
    this.setToken(response.access);
    return response;
  }

  async googleLogin(credential: string) {
    const response = await this.request("/auth/google/", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    this.setToken(response.access);
    return response;
  }

  async logout() {
    try {
      await this.request("/auth/logout/", { method: "POST" });
    } finally {
      this.setToken(null);
    }
  }

  async completeOnboarding(data: { username: string; first_name?: string; last_name?: string }) {
    return this.request("/auth/complete-onboarding/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getCurrentUser(): Promise<User> {
    return this.request("/auth/me/");
  }

  async verifyEmail(token: string) {
    return this.request(`/auth/verify-email/${token}/`, {
      method: "POST",
    });
  }

  async verifyMagicLink(token: string) {
    return this.request(`/auth/magic-link/verify/${token}/`, {
      method: "POST",
    });
  }

  async resendVerificationEmail() {
    return this.request("/auth/verify-email/request/", {
      method: "POST",
    });
  }

  async resendVerificationByUsername(username: string) {
    return this.request("/auth/verify-email/resend/", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
  }

  async getVerificationStatus(): Promise<{ email_verified: boolean; email: string }> {
    return this.request("/auth/verification-status/");
  }

  async requestPasswordReset(email: string) {
    return this.request("/auth/password-reset/request/", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, data: { password: string; password_confirm: string }) {
    return this.request(`/auth/password-reset/${token}/`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getProfile(): Promise<UserProfile> {
    return this.request("/profile/");
  }

  async updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
    return this.request("/profile/", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getAnalytics(): Promise<Analytics> {
    return this.request("/analytics/");
  }

  async getPublicProfile(username: string): Promise<PublicUserProfile> {
    return this.request(`/users/${username}/`);
  }

  async getPublicAnalytics(username: string): Promise<Analytics> {
    return this.request(`/users/${username}/analytics/`);
  }

  async getQuestions(
    page: number = 1,
    pageSize: number = 10,
    search?: string
  ): Promise<PaginatedResponse<Question>> {
    let url = `/questions/?page=${page}&page_size=${pageSize}`;
    if (search) {
      url += `&search=${encodeURIComponent(search)}`;
    }
    return this.request(url);
  }

  async getQuestion(id: number): Promise<Question> {
    return this.request(`/questions/${id}/`);
  }

  async getQuestionSubmissions(questionId: number): Promise<Submission[]> {
    return this.request(`/questions/${questionId}/submissions/`);
  }

  async submitEvaluation(data: {
    questionId: number;
    nodes: any[];
    edges: any[];
    customQuestion?: {
      title: string;
      description: string;
      constraints: Record<string, any>;
      difficulty: string;
    };
  }) {
    return this.request("/evaluate/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteAccount(password?: string, confirm?: boolean) {
    return this.request("/auth/delete-account/", {
      method: "POST",
      body: JSON.stringify({ password, confirm }),
    });
  }

  async getCreditStatus(): Promise<CreditStatus> {
    return this.request("/credits/");
  }

  async getCustomNodes(): Promise<CustomNodeDefinition[]> {
    return this.request("/custom-nodes/");
  }

  async createCustomNode(data: Partial<CustomNodeDefinition>): Promise<CustomNodeDefinition> {
    return this.request("/custom-nodes/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCustomNode(id: number, data: Partial<CustomNodeDefinition>): Promise<CustomNodeDefinition> {
    return this.request(`/custom-nodes/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteCustomNode(id: number): Promise<void> {
    return this.request(`/custom-nodes/${id}/`, {
      method: "DELETE",
    });
  }

  async getFollowUpQuestions(
    questionId: number,
    diagram: { nodes: any[]; edges: any[] },
    customQuestion?: {
      title: string;
      description: string;
      constraints: Record<string, any>;
    }
  ): Promise<FollowUpQuestionsResponse> {
    const body: any = {
      nodes: diagram.nodes,
      edges: diagram.edges,
    };
    if (customQuestion) {
      body.customQuestion = customQuestion;
    }
    return this.request(`/questions/${questionId}/follow-up-questions/`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}


export const apiClient = new ApiClient();
