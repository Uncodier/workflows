"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRolesConfig = void 0;
exports.getAgentByRole = getAgentByRole;
exports.getRolesByType = getRolesByType;
exports.getAllRoles = getAllRoles;
exports.getRoleNames = getRoleNames;
exports.getAgentTypeDistribution = getAgentTypeDistribution;
exports.validateAgentRoles = validateAgentRoles;
const agentsConfig_1 = require("./agentsConfig");
exports.agentRolesConfig = {
    'Growth Lead/Manager': {
        name: 'Growth Lead/Manager',
        type: 'marketing',
        description: 'Strategy integration, team coordination, budget management, KPI tracking',
        primaryResponsibilities: [
            'Task Monitoring',
            'Stakeholder Coordination',
            'Vendor Management',
            'Task Validation',
            'Team Coordination'
        ],
        skillAreas: [
            'Project Management',
            'Strategic Planning',
            'Team Leadership',
            'Performance Analytics',
            'Budget Management'
        ],
        icon: 'BarChart'
    },
    'Data Analyst': {
        name: 'Data Analyst',
        type: 'product',
        description: 'Data analysis, lead qualification, segmentation, performance metrics, optimization',
        primaryResponsibilities: [
            'User Behavior Analysis',
            'Sales Trend Analysis',
            'Cost Trend Analysis',
            'Cohort Health Monitoring',
            'Data-Driven Task Validation'
        ],
        skillAreas: [
            'Data Analytics',
            'Statistical Analysis',
            'Performance Metrics',
            'User Research',
            'Business Intelligence'
        ],
        icon: 'PieChart'
    },
    'Growth Marketer': {
        name: 'Growth Marketer',
        type: 'marketing',
        description: 'Marketing strategy, omnichannel campaigns, A/B testing, SEO techniques',
        primaryResponsibilities: [
            'Create Marketing Campaign',
            'SEO Content Optimization',
            'A/B Test Design',
            'Analyze Segments',
            'Campaign Requirements Creation'
        ],
        skillAreas: [
            'Digital Marketing',
            'Growth Hacking',
            'SEO/SEM',
            'A/B Testing',
            'Campaign Management'
        ],
        icon: 'TrendingUp'
    },
    'UX Designer': {
        name: 'UX Designer',
        type: 'product',
        description: 'Conversion optimization, UX/UI design for funnel, onboarding experience',
        primaryResponsibilities: [
            'Website Analysis',
            'Application Analysis',
            'Product Requirements Creation'
        ],
        skillAreas: [
            'User Experience Design',
            'User Interface Design',
            'Usability Testing',
            'Conversion Optimization',
            'Product Design'
        ],
        icon: 'Smartphone'
    },
    'Sales/CRM Specialist': {
        name: 'Sales/CRM Specialist',
        type: 'sales',
        description: 'Lead management, demos, systematic follow-up, sales cycle',
        primaryResponsibilities: [
            'Lead Follow-up Management',
            'Appointment Generation',
            'Lead Generation',
            'Lead Profile Research',
            'Generate Sales Order'
        ],
        skillAreas: [
            'Sales Management',
            'CRM Administration',
            'Lead Generation',
            'Sales Process Optimization',
            'Customer Relationship Management'
        ],
        icon: 'ShoppingCart'
    },
    'Customer Support': {
        name: 'Customer Support',
        type: 'sales',
        description: 'Knowledge base management, FAQ development, customer issue escalation',
        primaryResponsibilities: [
            'Knowledge Base Management',
            'FAQ Development',
            'Escalation Management'
        ],
        skillAreas: [
            'Customer Service',
            'Technical Support',
            'Documentation',
            'Issue Resolution',
            'Customer Success'
        ],
        icon: 'HelpCircle'
    },
    'Content Creator & Copywriter': {
        name: 'Content Creator & Copywriter',
        type: 'marketing',
        description: 'Persuasive copywriting, site content, blog posts, email sequences',
        primaryResponsibilities: [
            'Content Calendar Creation',
            'Email Sequence Copywriting',
            'Landing Page Copywriting'
        ],
        skillAreas: [
            'Content Creation',
            'Copywriting',
            'Content Strategy',
            'Email Marketing',
            'Brand Communication'
        ],
        icon: 'FileText'
    }
};
/**
 * Helper functions para trabajar con roles
 */
function getAgentByRole(roleName) {
    return agentsConfig_1.defaultAgentsConfig.agents.find(agent => agent.name === roleName);
}
function getRolesByType(type) {
    return Object.values(exports.agentRolesConfig).filter(role => role.type === type);
}
function getAllRoles() {
    return Object.values(exports.agentRolesConfig);
}
function getRoleNames() {
    return Object.keys(exports.agentRolesConfig);
}
function getAgentTypeDistribution() {
    const distribution = {};
    agentsConfig_1.defaultAgentsConfig.agents.forEach(agent => {
        distribution[agent.type] = (distribution[agent.type] || 0) + 1;
    });
    return distribution;
}
/**
 * Función para validar que todos los agentes tienen roles definidos
 */
function validateAgentRoles() {
    const agentNames = agentsConfig_1.defaultAgentsConfig.agents.map(agent => agent.name);
    const roleNames = getRoleNames();
    const missingRoles = agentNames.filter(name => !roleNames.includes(name));
    return {
        valid: missingRoles.length === 0,
        missingRoles
    };
}
