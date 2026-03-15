---
name: 'custom-tech-spec-review'
description: 'Pre-development tech spec review: AC validation, task audit, Technical Decisions review, test coverage review. Iterative fix-until-clean. Run AFTER writing a tech spec and BEFORE creating a story. Use when the user says "review tech spec", "run tech spec review", or "check this spec". Preferred over /bmad-review-adversarial-general for tech specs because it runs structured multi-round review phases and fixes the spec in-place rather than just reporting findings once.'
---

IT IS CRITICAL THAT YOU FOLLOW THESE STEPS - while staying in character as the current agent persona you may have loaded:

<steps CRITICAL="TRUE">
1. Always LOAD the FULL {project-root}/_bmad/core/tasks/workflow.xml
2. READ its entire contents - this is the CORE OS for EXECUTING the specific workflow-config {project-root}/_bmad/_config/custom/tech-spec-review/workflow.yaml
3. Pass the yaml path {project-root}/_bmad/_config/custom/tech-spec-review/workflow.yaml as 'workflow-config' parameter to the workflow.xml instructions
4. Follow workflow.xml instructions EXACTLY as written to process and follow the specific workflow config and its instructions
5. Save outputs after EACH section when generating any documents from templates
</steps>
