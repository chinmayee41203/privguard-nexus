import type { Metadata } from "next";
import Link from "next/link";
import { InstallPanel } from "../install-panel";

export const metadata: Metadata = {
  title: "Add PrivGuard Nexus to your repository",
  description: "Set up PrivGuard Nexus AI code review on your own GitHub repository in about 2 minutes.",
};

export default function InstallPage() {
  return (
    <div className="min-h-screen text-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="text-xs text-gray-400 hover:text-gray-200">
            ← Back to dashboard
          </Link>
          <span className="text-sm font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            PrivGuard Nexus
          </span>
        </div>
        <InstallPanel />
      </div>
    </div>
  );
}
