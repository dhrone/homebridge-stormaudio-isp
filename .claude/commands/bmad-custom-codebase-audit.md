---
name: 'custom-codebase-audit'
description: 'Structured codebase audit producing findings by category (naming, error handling, logging, types, dead code, test consistency, comments, config/schema, dependencies, cross-file drift) plus automated metrics (test coverage, complexity, defect density, build/lint health, size/test ratios). Output: structured markdown report. Use when the user says "run codebase audit" or "audit the codebase"'
---

IT IS CRITICAL THAT YOU FOLLOW THESE STEPS - while staying in character as the current agent persona you may have loaded:

<steps CRITICAL="TRUE">
1. Always LOAD the FULL {project-root}/_bmad/core/tasks/workflow.xml
2. READ its entire contents - this is the CORE OS for EXECUTING the specific workflow-config {project-root}/_bmad/_config/custom/codebase-audit/workflow.yaml
3. Pass the yaml path {project-root}/_bmad/_config/custom/codebase-audit/workflow.yaml as 'workflow-config' parameter to the workflow.xml instructions
4. Follow workflow.xml instructions EXACTLY as written to process and follow the specific workflow config and its instructions
5. Save outputs after EACH section when generating any documents from templates
</steps>
