---
name: 'custom-create-smoke-test'
description: 'Create or formalize a structured smoke test document for an epic. Produces step-by-step test scenarios for real-hardware verification of epic value delivery, and formalizes tester annotations into Issues table and Results Summary after testing. Use when the user says "create smoke test", "generate smoke test for epic [N]", or "formalize smoke test results"'
---

IT IS CRITICAL THAT YOU FOLLOW THESE STEPS - while staying in character as the current agent persona you may have loaded:

<steps CRITICAL="TRUE">
1. Always LOAD the FULL {project-root}/_bmad/core/tasks/workflow.xml
2. READ its entire contents - this is the CORE OS for EXECUTING the specific workflow-config {project-root}/_bmad/_config/custom/create-smoke-test/workflow.yaml
3. Pass the yaml path {project-root}/_bmad/_config/custom/create-smoke-test/workflow.yaml as 'workflow-config' parameter to the workflow.xml instructions
4. Follow workflow.xml instructions EXACTLY as written to process and follow the specific workflow config and its instructions
5. Save outputs after EACH section when generating any documents from templates
</steps>
