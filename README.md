# RE:TOUR - AI-Powered Interior Design Pipeline

## Project Info

Self-hosted interior design pipeline (React + Vite + Supabase)

## Pipeline Documentation

### Core Architecture

- **[Step 4 Operational Contract](docs/STEP_4_OPERATIONAL_CONTRACT.md)** - Defines the purpose, inputs, outputs, and boundaries of Step 4 (Camera-Aware Space Renders)
- **[Pipeline Happy Path](docs/PIPELINE_HAPPY_PATH.md)** - Documents the single valid execution flow through the pipeline (Steps 0→1→2→4→5→10)
- **[QA Responsibility Guide](docs/QA_RESPONSIBILITY_GUIDE.md)** - Clarifies QA boundaries between Step 5 (mandatory per-image validation) and Step 9 (external panorama validation)
- **[Explicit Non-Goals](docs/EXPLICIT_NON_GOALS.md)** - Documents what the system intentionally does NOT solve to prevent scope creep

### Phase 1 Implementation (Steps 3, 4, 5 Visibility) ✅ COMPLETE

- **[Phase 1 Completion Summary](docs/PHASE_1_COMPLETION_SUMMARY.md)** - Executive summary of Phase 1 delivery (Steps 3, 4, 5 visibility and traceability)
- **[Phase 1: Step 3 Implementation](docs/PHASE_1_STEP_3_IMPLEMENTATION.md)** - Camera Intent visibility implementation (Step 3 renamed, Decision-Only badge added, UI labels updated)
- **[Phase 1: Steps 4 & 5 Verification Report](docs/PHASE_1_STEPS_4_5_VERIFICATION_REPORT.md)** - Verification that Steps 4 & 5 implementation matches authoritative spec (FULLY COMPLIANT)

### Compliance & Verification

- **[Compliance Verification Report](docs/COMPLIANCE_VERIFICATION_REPORT.md)** - Audit report confirming current implementation is compliant with all approved operational contracts (2026-02-10)
- **[Step 3 Correction Summary](docs/STEP_3_CORRECTION_SUMMARY.md)** - Critical correction: Step 3 is active decision-only layer (may be implicit), NOT frozen

### Archived Specifications

- **[Camera Intent Implementation (FROZEN)](docs/archived-frozen/CAMERA_INTENT_IMPLEMENTATION.md)** - Step 3 specification (architecturally frozen, not executing)
- **[Archived Documentation](docs/archived-frozen/)** - Historical specifications and frozen features

### Technical Documentation

- **[Pipeline Synchronization Summary](docs/PIPELINE_SYNCHRONIZATION_SUMMARY.md)** - Latest synchronization status with locked pipeline specification
- **[Langfuse Integration](docs/LANGFUSE_INTEGRATION.md)** - Tracing and diagnostics setup
- **[QA Feedback Fix Summary](docs/QA_FEEDBACK_FIX_SUMMARY.md)** - Recent QA improvements

## How to Work with This Code

**Use your preferred IDE**

Requirements: Node.js & npm - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Deploy Backend Functions**

```sh
# Deploy Supabase edge functions
supabase functions deploy generate-camera-prompts
supabase functions deploy run-pipeline-step
```

**Build and Deploy Frontend**

```sh
# Build for production
npm run build

# The dist/ folder contains production-ready files
# Deploy using your preferred method (Vercel, Netlify, nginx, etc.)
```

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

This is a self-hosted project with multiple deployment options:

**Frontend Deployment**:
- Vercel: `vercel --prod`
- Netlify: `netlify deploy --prod --dir=dist`
- Self-hosted: Copy `dist/` folder to your web server
- Docker: Build a container with nginx serving the `dist/` folder

**Backend Deployment**:
- Supabase Edge Functions (already deployed)
- See `DEPLOYMENT_READY.md` for detailed instructions
