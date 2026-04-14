import React from 'react'

const sections = [
  {
    title: 'What We Store',
    body: 'When you turn Live Tracking on, RefuseRefuse stores sampled GPS points in your private account history on our servers. The app saves that data only while tracking is active.',
  },
  {
    title: 'How We Use It',
    body: 'Saved location data is used only to improve cleanup workflows, understand trash patterns and trends, and support product decisions grounded in real cleanup activity.',
  },
  {
    title: 'What We Do Not Do',
    body: 'We do not present your identity alongside public-facing location analysis. Any broader reporting from this data is anonymous or aggregated rather than tied to a named user profile.',
  },
  {
    title: 'Deletion Rights',
    body: 'You can request deletion of your saved location history directly inside the app settings. Deleting that history permanently removes your stored location sessions and saved points from your account.',
  },
  {
    title: 'Retention Period',
    body: 'Saved location history is retained until you delete it through the app settings or the account data is otherwise removed. There is no automatic expiration window configured today.',
  },
  {
    title: 'Storage And Security',
    body: 'Location history is stored behind authenticated access and is intended to be handled securely and safely as private account data.',
  },
  {
    title: 'Privacy Contact',
    body: 'If you have a privacy question, need help with deletion, or believe your location data was handled incorrectly, contact the RefuseRefuse support or privacy contact for the organization operating this deployment.',
  },
]

export default function PrivacyPolicyPage() {
  return (
    <div className="privacy-policy-page">
      <div className="privacy-policy-shell">
        <a className="privacy-policy-backlink" href="#/">
          Back to map
        </a>

        <div className="privacy-policy-hero">
          <div className="privacy-policy-eyebrow">Privacy Policy</div>
          <h1 className="privacy-policy-title">Location data is private account data, not public identity data.</h1>
          <p className="privacy-policy-intro">
            RefuseRefuse stores location history only when you deliberately enable Live Tracking. That saved history exists to improve the app, study cleanup and trash trends, and support anonymous analysis rather than expose individual users.
          </p>
        </div>

        <div className="privacy-policy-grid">
          {sections.map((section) => (
            <section key={section.title} className="privacy-policy-card">
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </div>

        <div className="privacy-policy-footer">
          <a className="privacy-policy-footer-link" href="#/">
            Return to RefuseRefuse
          </a>
        </div>
      </div>
    </div>
  )
}