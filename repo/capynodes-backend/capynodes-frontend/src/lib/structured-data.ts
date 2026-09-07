const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://capynodes.vercel.app";

export function getOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "CapyNodes",
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description: "A web-based node editor for practicing AI/ML system design interviews",
    founder: {
      "@type": "Person",
      name: "Piyush Choudhari",
      url: "https://piyushchoudhari.me/",
    },
    sameAs: [],
  };
}

export function getWebApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "CapyNodes",
    url: baseUrl,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web Browser",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description: "Build production-ready AI/ML architectures with our drag-and-drop editor. Get instant AI-powered feedback on your system designs.",
    featureList: [
      "58+ Production-Grade Components",
      "Hybrid Evaluation with AI Feedback",
      "Real-World Scenarios",
      "6 Evaluation Metrics",
      "Anti-Pattern Detection",
      "Skills Analytics",
    ],
  };
}

export function getBreadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

