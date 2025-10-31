# Temporal Workflows

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

A scalable, serverless workflow orchestration system built with Temporal.io, Next.js, and Supabase. This project provides a comprehensive suite of durable, fault-tolerant workflows for lead generation, customer support, email validation, and automated business operations.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the [LICENSE](LICENSE) file for details.

> **Note**: AGPL-3.0 requires that any modifications or usage of this software must also be licensed under AGPL-3.0, including when running as a network service.

## Features

- **Durable Workflows**: Long-running, fault-tolerant processes powered by Temporal.io
- **Lead Management**: Automated lead generation, research, qualification, and follow-up workflows
- **Customer Support**: Integrated email and WhatsApp message processing with AI-powered responses
- **Email Validation**: Gateway policy validation for email addresses
- **Automated Operations**: Daily stand-ups, prospection, strategic accounts management
- **Campaign Management**: Automated campaign building, segmentation, and content generation
- **Scheduled Execution**: Cron-like scheduling for recurring workflows
- **Serverless Deployment**: Deploy and scale workflows on Vercel and Render
- **Supabase Integration**: Data storage and configuration management
- **API Endpoints**: REST API for triggering workflows and managing schedules

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Temporal server (local or Temporal Cloud)
- Supabase account
- Environment variables configured (see below)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd Workflows

# Install dependencies
npm install

# Copy environment template
cp env.example .env.local

# Configure your environment variables
# Edit .env.local with your credentials
```

### Running Locally

```bash
# Start Temporal worker in development mode
npm run start-worker

# In a separate terminal, execute a workflow
npm run test-validate-email

# Or run specific workflow tests
npm run test-lead-generation
npm run test-customer-support
npm run test-daily-standup
```

## Available Workflows

This project includes a comprehensive set of workflows for business automation:

### Lead Management
- **Lead Generation**: Automated lead discovery and qualification
- **Lead Research**: Deep research on leads and companies
- **Lead Qualification**: AI-powered lead scoring and validation
- **Lead Follow-up**: Automated follow-up sequences
- **Lead Attention**: Priority-based lead handling
- **Lead Invalidation**: Automated lead cleanup

### Customer Support
- **Customer Support Message**: Multi-channel message processing (Email/WhatsApp)
- **Email Customer Support**: Email-specific support workflows
- **WhatsApp Integration**: WhatsApp message processing and responses

### Operations & Automation
- **Daily Stand-up**: Automated daily reporting and task management
- **Daily Prospection**: Automated prospection workflows
- **Daily Strategic Accounts**: Strategic account management
- **Daily Operations**: System health monitoring and maintenance
- **Site Setup**: Automated site configuration workflows
- **Analyze Site**: Site analysis and data extraction

### Marketing & Campaigns
- **Build Campaigns**: Automated campaign creation
- **Build Segments**: Audience segmentation workflows
- **Build Content**: Content generation workflows
- **Send Newsletter**: Newsletter distribution workflows
- **Ideal Client Profile (ICP) Mining**: Automated ICP research

### Infrastructure
- **Email Validation**: Gateway policy validation
- **Sync Emails**: Email synchronization workflows
- **Webhook Dispatch**: Webhook delivery system
- **Robot Workflow**: General-purpose automation
- **Human Intervention**: Workflows requiring human approval

See the [workflows documentation](docs/workflows/) for detailed information on each workflow.

## Project Structure

```
Workflows/
├── api/                      # Vercel serverless API endpoints
│   ├── worker.js             # Worker entry point
│   ├── status.js             # Status check endpoint
│   └── execute-workflow.js   # Workflow execution endpoint
├── src/
│   ├── config/               # Configuration files
│   ├── lib/                  # Utility libraries
│   │   ├── email-validation/ # Email validation logic
│   │   └── supabase/         # Supabase client
│   ├── scripts/              # CLI scripts and utilities
│   └── temporal/             # Temporal.io integration
│       ├── activities/       # Workflow activities
│       ├── client/           # Temporal client
│       ├── config/           # Temporal configuration
│       ├── scheduler/        # Workflow scheduler
│       ├── workers/          # Temporal workers
│       └── workflows/        # Workflow definitions
├── docs/                     # Comprehensive documentation
├── examples/                 # Example usage scripts
├── tests/                    # Test files
└── scripts/                  # Deployment and utility scripts
```

## Environment Variables

Create a `.env.local` file based on `env.example`:

```bash
# Temporal Configuration
TEMPORAL_SERVER_URL=localhost:7233
TEMPORAL_NAMESPACE=default
WORKFLOW_TASK_QUEUE=default
# For Temporal Cloud:
# TEMPORAL_API_KEY=your-api-key
# TEMPORAL_TLS=true

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# API Configuration
API_BASE_URL=https://your-api-url
API_KEY=your-api-key

# Application Configuration
LOG_LEVEL=info
```

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific test files
npm run test-validate-email
npm run test-lead-generation
```

### Available Scripts

```bash
# Development
npm run dev                  # Start Next.js dev server
npm run start-worker         # Start Temporal worker

# Testing
npm run test                 # Run Jest tests
npm run test-*               # Run specific workflow tests

# Build
npm run build                # Build Next.js app
npm run build:all            # Build Next.js + compile TypeScript

# Schedule Management
npm run create-schedules     # Create all schedules
npm run delete-schedules     # Delete all schedules
npm run recreate-schedules   # Recreate all schedules
```

## Deployment

This project supports deployment on multiple platforms:

### Vercel Deployment

See [docs/RENDER_DEPLOYMENT.md](docs/RENDER_DEPLOYMENT.md) for detailed Vercel deployment instructions.

### Render Deployment

See [docs/RENDER_DEPLOYMENT.md](docs/RENDER_DEPLOYMENT.md) for Render deployment setup.

### Temporal Cloud

For production use, connect to Temporal Cloud:

1. Create an account at [Temporal Cloud](https://temporal.io/cloud)
2. Create a namespace for your workflows
3. Configure environment variables with your Temporal Cloud credentials
4. See [docs/TEMPORAL_CLOUD_SETUP.md](docs/TEMPORAL_CLOUD_SETUP.md) for details

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- **[Main Documentation](docs/README.md)** - Complete setup and usage guide
- **[Workflow Guides](docs/workflows/)** - Detailed documentation for each workflow
- **[Temporal Setup](docs/TEMPORAL_CLOUD_SETUP.md)** - Temporal Cloud configuration
- **[Deployment Guide](docs/RENDER_DEPLOYMENT.md)** - Deployment instructions
- **[Database Schema](docs/supabase/)** - Supabase database structure
- **[Workflow Prioritization](docs/WORKFLOW_PRIORITIZATION_GUIDE.md)** - Priority system guide
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions

## Contributing

Contributions are welcome! Please ensure that:

1. All code follows the existing TypeScript/JavaScript style
2. Tests are included for new features
3. Documentation is updated accordingly
4. All code and comments are in English

## License

Copyright (c) 2024

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

