'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { X } from 'lucide-react';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentProfile: {
    first_name: string;
    last_name: string;
    bio: string;
    linkedin_url: string;
    twitter_url: string;
    github_url: string;
    website_url: string;
  };
}

export default function EditProfileModal({
  isOpen,
  onClose,
  onSuccess,
  currentProfile,
}: EditProfileModalProps) {
  const [formData, setFormData] = useState(currentProfile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlErrors, setUrlErrors] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const validateUrl = (url: string, fieldName: string): boolean => {
    if (!url.trim()) {
      setUrlErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return true;
    }

    try {
      new URL(url);
      setUrlErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return true;
    } catch {
      setUrlErrors((prev) => ({
        ...prev,
        [fieldName]: 'Please enter a valid URL',
      }));
      return false;
    }
  };

  const handleUrlChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (value.trim()) {
      validateUrl(value, field);
    } else {
      setUrlErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const urlFields = ['linkedin_url', 'twitter_url', 'github_url', 'website_url'];
    let hasErrors = false;
    
    urlFields.forEach((field) => {
      const value = formData[field as keyof typeof formData];
      if (value && !validateUrl(value, field)) {
        hasErrors = true;
      }
    });

    if (hasErrors) {
      setError('Please fix the URL errors before saving');
      return;
    }

    setLoading(true);
    try {
      const updateData: Record<string, string> = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        bio: formData.bio,
      };

      urlFields.forEach((field) => {
        const value = formData[field as keyof typeof formData];
        updateData[field] = value || '';
      });

      await apiClient.updateProfile(updateData);
      onSuccess();
    } catch (err) {
      console.error('Failed to update profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData(currentProfile);
    setError(null);
    setUrlErrors({});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Edit Profile</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={loading}
          >
            <X size={20} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">First Name</label>
                <Input
                  value={formData.first_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, first_name: e.target.value }))
                  }
                  placeholder="Enter your first name"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Last Name</label>
                <Input
                  value={formData.last_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, last_name: e.target.value }))
                  }
                  placeholder="Enter your last name"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">Bio</label>
              <textarea
                value={formData.bio}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, bio: e.target.value }))
                }
                placeholder="Tell us about yourself"
                disabled={loading}
                rows={4}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            <div className="space-y-4 pt-2">
              <h3 className="text-lg font-semibold">Social Links</h3>

              <div className="space-y-2">
                <label className="text-sm font-semibold">LinkedIn</label>
                <Input
                  value={formData.linkedin_url}
                  onChange={(e) => handleUrlChange('linkedin_url', e.target.value)}
                  placeholder="https://linkedin.com/in/yourprofile"
                  disabled={loading}
                />
                {urlErrors.linkedin_url && (
                  <p className="text-sm text-red-600">{urlErrors.linkedin_url}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">X (Twitter)</label>
                <Input
                  value={formData.twitter_url}
                  onChange={(e) => handleUrlChange('twitter_url', e.target.value)}
                  placeholder="https://x.com/yourhandle"
                  disabled={loading}
                />
                {urlErrors.twitter_url && (
                  <p className="text-sm text-red-600">{urlErrors.twitter_url}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">GitHub</label>
                <Input
                  value={formData.github_url}
                  onChange={(e) => handleUrlChange('github_url', e.target.value)}
                  placeholder="https://github.com/yourusername"
                  disabled={loading}
                />
                {urlErrors.github_url && (
                  <p className="text-sm text-red-600">{urlErrors.github_url}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Website</label>
                <Input
                  value={formData.website_url}
                  onChange={(e) => handleUrlChange('website_url', e.target.value)}
                  placeholder="https://yourwebsite.com"
                  disabled={loading}
                />
                {urlErrors.website_url && (
                  <p className="text-sm text-red-600">{urlErrors.website_url}</p>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-100 border border-red-300 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || Object.keys(urlErrors).length > 0}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

