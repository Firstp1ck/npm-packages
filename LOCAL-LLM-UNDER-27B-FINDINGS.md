# Local LLMs up to 27B parameters: uses, limits, and failure modes

- **Scope:** Open-weight language models with **27 billion parameters or fewer** that can run on user-controlled desktops, laptops, workstations, or edge servers.
- **Research date:** 2026-08-12.
- **Interpretation:** “Local” means inference happens on hardware you control. It does **not** imply that the model, license, application, or surrounding tools are open source.
- **Evidence policy:** Official model cards and project documentation establish intended uses, specifications, and vendor-reported benchmarks. Peer-reviewed papers and published workshop papers establish measured failure patterns. Vendor benchmark claims are treated as directional, not as independent proof.
- **Overall finding:** A good local model is best treated as a **fast, private, fallible component for bounded tasks**, not as an autonomous authority. Models in the 7B–27B range can handle substantial drafting, extraction, classification, retrieval-grounded Q&A, and limited coding, but reliability drops on obscure facts, exact long-context work, repository-scale coding, complex tool use, multi-step autonomy, and high-stakes decisions.
- **Overall confidence:** **91/100.** Confidence is high for the broad use/failure map and cited model specifications. It is lower for hardware fit and speed because those depend heavily on quantization, context length, inference engine, memory bandwidth, and the exact machine.

## 1. Representative model classes

- **Very small models (roughly 0.5B–4B)**
  - Best suited to classification, routing, autocomplete, short extraction, templated rewriting, and narrow fine-tuned tasks.
  - Their main advantage is low memory and latency; their main weakness is low capacity for knowledge, nuance, and multi-step reasoning.
  - They are more likely to miss constraints, lose coherence, or need task-specific training.

- **Small general models (roughly 7B–14B)**
  - Often the practical laptop/desktop tier after 4-bit quantization.
  - Examples include Llama 3.1 8B, Qwen3 8B/14B, Phi-4 14B, and Gemma 3 12B.
  - They can be useful for chat, document work, RAG, common programming, and structured transformations when outputs are validated.
  - Official evidence illustrates specialization trade-offs: Phi-4 14B reports strong math/reasoning benchmarks but only **3.0 on SimpleQA**, versus 80.4 on MATH and 82.6 on HumanEval in its model card. This is a clear warning that reasoning benchmark strength does not imply broad factual reliability. [S4]

- **Upper local tier (roughly 20B–27B)**
  - Examples include Mistral Small 3/3.1 24B and Gemma 3 27B.
  - These usually improve prose, instruction following, coding, multilingual performance, and robustness over smaller siblings, but do not eliminate hallucination or agent failures.
  - Mistral reports that quantized Mistral Small 3 can run on one RTX 4090 or a Mac with 32 GB RAM. [S3]
  - Google reports that Gemma 3 27B weights require about **54 GB in BF16** and **14.1 GB in its INT4 quantization-aware-trained form**. This is weight memory only; runtime overhead and the KV cache add more. [S9]

- **Architecture matters as much as parameter count**
  - Dense parameter count is not a complete predictor of speed or quality.
  - Attention design, active parameters in mixture-of-experts models, tokenizer, training data, post-training, context implementation, and inference kernels all matter.
  - Compare models on the target machine and target task rather than selecting solely by “B” count.

## 2. Where local models are useful

- **Private drafting and rewriting**
  - Draft emails, notes, reports, documentation, outlines, and alternatives.
  - Rewrite for tone, clarity, length, or reading level.
  - Useful because source text need not leave the machine.
  - Human review remains necessary where wording has legal, reputational, or contractual consequences.

- **Summarization of bounded material**
  - Summarize a meeting transcript, article, log segment, or selected files.
  - Produce action-item candidates, headings, glossaries, or comparisons.
  - Most reliable when the requested output is traceable to supplied text and the context is kept focused.
  - Gemma’s official model card explicitly lists summarization, question answering, and research-document exploration as intended uses. [S1]

- **Information extraction and transformation**
  - Extract names, dates, entities, fields, tags, tables, or candidate JSON from text.
  - Normalize descriptions and map free text into a controlled taxonomy.
  - Convert between lightweight formats or produce schema candidates.
  - Best when a deterministic parser/schema validator rejects malformed or unsupported output.

- **Classification and routing**
  - Sentiment, intent, topic, urgency, moderation triage, document type, and workflow routing.
  - Small models are attractive here because prompts and outputs are short and the label set is bounded.
  - Use confidence thresholds and an “unknown/escalate” route rather than forcing every input into a class.

- **Retrieval-augmented question answering (RAG)**
  - Search a local document collection, provide a small set of relevant passages, and ask for an answer with citations.
  - Suitable for manuals, internal policies, knowledge bases, research notes, and personal archives.
  - A CHOMPS 2025 evaluation found roughly 7B open models to be a practical efficiency/robustness compromise in noisy RAG, while approximately 70B models had greater noise tolerance at much higher computational cost. [S8]
  - RAG improves access to current or private facts; it does not guarantee faithful use of retrieved evidence.

- **Local search assistance**
  - Generate search queries, expand synonyms, rerank a small candidate set, or summarize already-retrieved passages.
  - Keep retrieval and citation generation mechanically auditable.
  - Do not let the model invent document IDs, paths, quotations, or citations without verification.

- **Coding assistance on bounded scope**
  - Explain a function, draft unit tests, generate boilerplate, transform data, write regexes, suggest small patches, or review a focused diff.
  - Stronger results are usually obtained with code-specialized models and test feedback.
  - Gemma 3 27B reports 87.8 on HumanEval but only 29.7 on LiveCodeBench in its official evaluation. Different benchmark difficulty and freshness make the gap a warning against equating short-function benchmark success with real-world coding reliability. [S1]
  - A quantized-code study found 4-bit 7B models to offer the best size/performance trade-off on its consumer laptop, but overall performance remained below 50% on high-precision, low-resource Lua generation tasks. [S7]

- **Interactive learning and brainstorming**
  - Generate examples, quizzes, alternative explanations, practice prompts, and counterarguments.
  - Useful as a conversational aid, especially offline.
  - Answers should be checked against authoritative material; fluent explanations can still encode false premises.

- **Translation and language support**
  - Draft translations, simplify language, correct grammar, or practice dialogue.
  - Capability varies sharply by model and language. Qwen3 claims support for 119 languages and dialects, while Phi-4 says it is primarily English and not intended for multilingual use. [S2][S4]
  - Low-resource languages, dialects, idioms, sarcasm, and culturally specific nuance are higher-risk.

- **Low-latency local assistants**
  - Command interpretation, application help, note capture, autocomplete, and short conversational responses.
  - Mistral identifies fast conversation and low-latency function calling as target uses for its 24B model. [S3]
  - Local execution avoids network round trips, but generation speed is limited by memory bandwidth, quantization format, prompt length, and hardware.

- **Domain adaptation**
  - Fine-tune or use adapters for a narrow vocabulary, style, label set, or workflow.
  - Mistral explicitly positions its 24B base model for specialist fine-tuning. [S3]
  - Fine-tuning improves learned behavior; it is not a reliable database update mechanism and may introduce regressions or hallucinations.

- **Offline and air-gapped use**
  - Useful where connectivity is unavailable, unreliable, expensive, or prohibited.
  - Enables continued use during cloud outages and makes model version pinning possible.
  - Verify that the host application, model manager, plugins, telemetry, embeddings service, and update mechanism are also offline; local inference alone does not prove an air gap.

- **Synthetic data and first-pass annotation**
  - Generate candidate examples, paraphrases, labels, or test cases for later filtering.
  - Good for increasing human throughput when acceptance criteria are explicit.
  - Unsafe as an unreviewed source of ground truth because model errors and biases become training data.

- **Hybrid local/cloud routing**
  - Handle easy, private, high-volume tasks locally and escalate uncertain or complex cases to a stronger model or a person.
  - This is often more reliable than forcing one small model to solve every request.
  - Routing itself must be tested: a weak model may underestimate task difficulty or fail to escalate.

## 3. Operational advantages

- **Data control**
  - Prompts and outputs can remain on equipment under the operator’s control.
  - This reduces exposure to third-party inference providers.
  - It does not protect against malware, insecure logs, backups, plugins, RAG data leaks, or network-enabled front ends.

- **Offline availability**
  - No dependency on provider uptime, account status, rate limits, or API policy changes during inference.
  - Model acquisition and software updates still require a trusted supply path.

- **Predictable marginal cost**
  - After hardware and setup costs, repeated inference does not incur per-token API charges.
  - Electricity, hardware depreciation, maintenance, and engineering time remain real costs.

- **Control and reproducibility**
  - Pin exact weights, quantization, tokenizer, system prompt, inference engine, and sampling settings.
  - Easier to regression-test than a silently changing hosted model.
  - Outputs can still vary with nondeterministic kernels, sampling, prompt templates, or software changes.

- **Customization**
  - Operators can choose quantization, context limits, decoding, adapters, grammars, tools, and safety policy.
  - Open weights make inspection and local adaptation possible, subject to the model license.

- **Broad hardware support**
  - `llama.cpp` supports CPU inference, CUDA, Metal, HIP, Vulkan, SYCL, and CPU/GPU hybrid execution, plus integer quantization from 1.5 to 8 bits. [S5]
  - “Supported” does not mean equally fast, equally accurate, or equally mature on every backend.

## 4. Where models at or below 27B fail

- **Unknown, obscure, or current facts**
  - Models are static snapshots and do not know events after their training cutoff unless external retrieval is provided.
  - Long-tail facts have fewer training examples and are more likely to be missing or confused.
  - Phi-4’s model card gives a June 2024-or-earlier public-data cutoff; Gemma 3 gives August 2024. [S1][S4]
  - Failure often appears as a plausible, specific answer rather than a visible error.

- **Hallucination and poor abstention**
  - A model can fabricate names, dates, citations, APIs, quotations, events, or causal explanations.
  - HalluLens tested nonexistent entities and found substantial false acceptance among models in this size range. Reported average false-acceptance rates included **29.64% for Qwen2.5 14B**, **40.95% for Gemma 2 27B**, and **49.35% for Qwen2.5 7B**; lower is better. Results varied considerably by model family, so parameter count alone did not predict safe abstention. [S6]
  - Standard accuracy benchmarks often reward guessing and give no credit for “I don’t know,” which helps explain confident fabrication. [S11]

- **Factuality is not the same as fluency or reasoning**
  - A model may solve a formal math pattern while failing a simple factual question.
  - It may produce a coherent explanation for an incorrect conclusion.
  - Treat eloquence, chain-of-thought length, and confidence language as stylistic signals—not evidence.

- **Long-context degradation**
  - A advertised 128K context window means the software can accept that many tokens; it does not guarantee accurate use of all of them.
  - RULER found that almost all tested long-context models degraded substantially as sequence length and task complexity grew, despite strong simple needle-retrieval results. Only about half maintained the study’s satisfactory threshold at 32K. [S10]
  - Observed failure patterns included distractor confusion, incomplete multi-item retrieval, duplicated answers, imprecise matches, and copying irrelevant context.
  - Large context also consumes KV-cache memory and reduces speed.

- **“Lost in the middle” and attention dilution**
  - Evidence buried among many irrelevant passages may be ignored.
  - Repeating, contradictory, or similarly worded passages can dominate the answer.
  - Mitigation: retrieve fewer, better chunks; place decisive evidence clearly; and test evidence-position sensitivity.

- **RAG with bad retrieval**
  - If retrieval returns irrelevant, stale, contradictory, poisoned, or incomplete passages, the model may synthesize them confidently.
  - Smaller models generally have less capacity to separate signal from distractors.
  - RAG cannot repair a missing source, a bad query, or a task requiring calculation rather than lookup.

- **Faithfulness to supplied documents**
  - Summaries can add unsupported details, omit exceptions, reverse a relationship, or merge separate entities.
  - Exact counts, dates, qualifications, and negations are especially important to verify.
  - Require citations to source spans and check them mechanically or manually.

- **Exact counting and exhaustive extraction**
  - LLMs are weak substitutes for parsers, database queries, arithmetic tools, and set operations.
  - They may miss one item, duplicate another, or silently normalize text that was meant to be copied exactly.
  - Use code for counts, deduplication, sorting, checksums, and exact matching.

- **Complex multi-step reasoning**
  - Errors compound across long chains even when each individual step sounds plausible.
  - Models may forget constraints introduced earlier, solve a nearby easier problem, or rationalize a mistaken intermediate result.
  - “Thinking” mode can improve some tasks, but more generated reasoning is not a correctness guarantee.

- **Planning and long-horizon autonomy**
  - Small models often fail to maintain state, recognize completion, recover from errors, or revise a plan after unexpected tool output.
  - They may loop, repeat actions, or stop after only part of a request.
  - Use short horizons, explicit state machines, hard budgets, checkpoints, and human approval for consequential actions.

- **Tool selection and function calling**
  - ToolScan identifies insufficient calls, wrong values, hallucinated argument names, wrong types, repeated calls, nonexistent function names, and invalid output formats. [S12]
  - Its model-level analysis found that several ≤14B models omitted required or optional arguments, repeated calls, or struggled with strict tool formatting.
  - Tool capability advertised in a model card does not prove reliability with a different prompt template, parser, quantization, language, or tool catalog.

- **Structured output and JSON**
  - Models may emit commentary around JSON, invalid escaping, the wrong type, missing required fields, or values outside an enum.
  - Constrained decoding helps syntax but cannot guarantee semantic correctness.
  - Validate every output against a schema and reject or repair deterministically.

- **Coding beyond small functions**
  - Repository-scale work requires navigation, dependency tracing, architecture awareness, tests, and iterative repair.
  - Models may invent APIs, use obsolete versions, mishandle concurrency/security, or change unrelated code.
  - Benchmarks such as HumanEval emphasize short isolated functions and can overstate production usefulness.
  - Always compile, lint, test, review diffs, and sandbox generated commands.

- **Rare programming languages and libraries**
  - Models perform worse when training data is scarce.
  - The quantized-code study found practical weakness on Lua despite feasible local execution, and Phi-4 warns that its code data is primarily Python with common packages. [S7][S4]
  - API versions released after the model cutoff are especially likely to be hallucinated.

- **Math and exact computation**
  - A model can choose the wrong formula, make an arithmetic slip, or present a false proof.
  - Specialized reasoning models may score well on contest datasets but still fail novel, adversarial, or differently formatted problems.
  - Use a calculator, symbolic engine, executable code, or formal verifier for exact results.

- **Multilingual and low-resource language quality**
  - Performance and safety vary by language, not just by whether the model can produce text in it.
  - Models may mix languages, translate literally, lose legal/technical nuance, or perform substantially worse outside dominant training languages.
  - Safety evaluations are often English-heavy; Gemma 3 explicitly says a limitation of its reported safety evaluations was English-only prompts. [S1]

- **Nuance, ambiguity, irony, and social context**
  - Models can miss sarcasm, indirect requests, local conventions, power dynamics, or what a speaker intentionally left unsaid.
  - Smaller models are more likely to collapse ambiguity into one confident interpretation.
  - Ask for alternative interpretations and preserve the original text for human judgment.

- **Bias and representational harms**
  - Open-weight models inherit social and demographic patterns from training data.
  - They can stereotype, underrepresent groups, or differ in quality across language varieties.
  - Local deployment transfers monitoring, policy, and red-team responsibility to the operator. [S1][S4]

- **Safety alignment gaps**
  - Quantized or community fine-tuned checkpoints may behave differently from the official checkpoint.
  - A model may over-refuse benign requests or comply with harmful ones.
  - Model-level alignment is not a substitute for application authorization and output controls.

- **Prompt injection**
  - A document, web page, email, image, or retrieved chunk can contain instructions that compete with the operator’s prompt.
  - Local execution does not prevent injection; it only changes where the vulnerable system runs.
  - OWASP explicitly includes indirect and RAG prompt injection and recommends separation of instructions from data, least privilege, input/output validation, and human approval for high-risk actions. [S13]

- **Unsafe tool side effects**
  - A wrong tool call can delete files, disclose data, send messages, spend money, or alter infrastructure.
  - Never give the model unrestricted shell, filesystem, network, email, or account privileges.
  - Enforce allowlists, typed arguments, sandboxing, dry runs, transaction boundaries, and approval gates outside the model.

- **Privacy leakage despite local inference**
  - Sensitive prompts may be stored in chat history, swap, crash dumps, shell history, vector databases, traces, or backups.
  - RAG can expose one user’s documents to another if access control is applied after retrieval rather than before it.
  - Models may reproduce sensitive context in later outputs if application state is not isolated.

- **Supply-chain and license risk**
  - Model files, quantizations, adapters, inference binaries, and UI packages can be tampered with.
  - “Open weight” licenses differ in commercial terms, attribution, acceptable use, and redistribution.
  - Verify hashes/signatures where available, prefer official publishers, pin versions, scan dependencies, and review the actual license.

- **Quantization degradation**
  - Lower precision reduces memory but can damage output quality.
  - The cited code study found 4-bit to be the best tested compromise, while 2-bit caused significant degradation and could produce incoherent output. [S7]
  - The effect is model-, method-, task-, and hardware-dependent; a quantization label alone is insufficient.

- **Memory estimates are easy to understate**
  - Approximate raw weight memory is `parameters × bits / 8`, but real inference also needs runtime buffers, KV cache, embeddings, allocator headroom, and sometimes vision components.
  - Longer prompts, larger batches, and more concurrent users increase memory.
  - A model that barely loads may become very slow through CPU offload or fail at its advertised maximum context.

- **CPU-only latency**
  - Quantization can make models fit in system RAM, but fitting is not the same as interactive speed.
  - Prompt ingestion and token generation have different bottlenecks; long prompts may take much longer than short chat tests.
  - Measure time-to-first-token, decode tokens/second, memory, power, and quality on the intended workload.

- **Thermal and power constraints**
  - Sustained laptop or edge inference can throttle under heat and drain batteries quickly.
  - Peak benchmark speed may not survive a long session.
  - Cooling, memory bandwidth, power limits, and unified-memory pressure can dominate parameter-count expectations.

- **Low concurrency**
  - A model that feels fast for one user can degrade sharply under parallel requests because KV caches and compute compete for limited memory.
  - Desktop GPUs optimized for one interactive session are not automatically production servers.

- **Benchmark overinterpretation**
  - Scores differ with prompts, chat templates, number of shots, decoding, judges, contamination, and formatting rules.
  - Vendor-reported comparisons may use internal pipelines or model-as-judge evaluation.
  - A benchmark average hides catastrophic failures on individual task types.
  - Build a private evaluation set from real inputs, including abstention, edge cases, adversarial content, and end-to-end tool execution.

- **Nondeterminism and reproducibility gaps**
  - Temperature zero reduces but may not eliminate variation across engines/hardware.
  - Different GGUF conversions, quantization methods, tokenizers, templates, or parser settings can materially alter behavior.
  - Record the exact model revision, file hash, engine version, template, parameters, and hardware.

## 5. Tasks that should not rely on an unverified local model

- **Medical diagnosis or treatment decisions** without qualified review and validated clinical systems.
- **Legal conclusions, filings, or contract interpretation** without authoritative sources and professional review.
- **Credit, employment, housing, insurance, education, or benefits decisions** without tested fairness, appeal, and legally compliant human oversight.
- **Security-sensitive code or incident response actions** without expert review, sandboxing, and independent verification.
- **Unattended shell, infrastructure, financial, or communication actions** with broad permissions.
- **Canonical records, exact accounting, compliance calculations, or database migration logic** where a deterministic program is appropriate.
- **Claims about current events or obscure facts** without retrieval and source verification.
- **Final translations of safety-critical, legal, or medical material** without a qualified translator.

## 6. Practical deployment pattern

- **Choose by task, not leaderboard rank**
  - Define the exact input distribution, output contract, latency target, privacy boundary, and maximum acceptable error.
  - Compare at least one small model, one upper-local model, and a stronger reference model.

- **Start with the smallest model that passes a real evaluation**
  - Smaller models are cheaper and faster, but only if they meet quality thresholds.
  - Escalate based on measured failure, not on the assumption that more parameters always win.

- **Keep context focused**
  - Retrieve relevant passages instead of dumping entire repositories or document collections into the prompt.
  - Remove duplicates and clearly separate trusted instructions from untrusted content.

- **Ground factual tasks**
  - Require source IDs and quoted evidence.
  - Verify that each citation exists and supports the claim.
  - Allow abstention when evidence is missing or conflicting.

- **Make uncertainty actionable**
  - Provide explicit “unknown,” “needs review,” and “insufficient evidence” outcomes.
  - Calibrate thresholds on held-out data; self-reported confidence is not enough.

- **Constrain outputs**
  - Use grammars or constrained decoding for syntax.
  - Apply schema validation, range checks, allowlists, and business rules after generation.

- **Use deterministic tools for deterministic work**
  - Calculators for arithmetic, parsers for syntax, databases for lookup, test runners for code, and policy engines for authorization.
  - Let the model propose; let deterministic systems verify and execute.

- **Bound agents**
  - Limit steps, time, tokens, tools, permissions, and spend.
  - Make tools idempotent where possible and require approval for irreversible effects.

- **Evaluate failure modes directly**
  - Include nonexistent entities, stale facts, ambiguous prompts, conflicting documents, prompt injection, malformed inputs, long contexts, multilingual cases, and unavailable tools.
  - Track exact-match correctness, citation support, abstention quality, schema validity, tool execution success, latency, memory, and energy—not just subjective answer quality.

- **Run a quantization bake-off**
  - Compare the official/high-precision checkpoint with candidate 8-, 6-, 5-, and 4-bit builds on the actual task.
  - Use 2–3 bit only after demonstrating acceptable task quality.

- **Operate it like production software**
  - Pin artifacts, hash model files, isolate user data, restrict logs, patch runtimes, monitor failures, and keep rollback paths.
  - Re-evaluate after any model, quantization, prompt, retrieval, parser, or inference-engine change.

- **Adopt escalation rules**
  - Escalate when evidence is absent, model outputs disagree, validation fails, the request is high-risk, or the model loops.
  - A human or stronger remote model should receive the original evidence and failure trace, not only the local model’s summary.

## 7. Quick decision list

- **Good default candidates for local use**
  - Drafting and rewriting with review.
  - Focused summarization with source checks.
  - Classification with an unknown/escalation class.
  - Local RAG with access control and citation verification.
  - Small coding tasks with compilation and tests.
  - Search-query generation and document reranking.
  - Offline personal assistance with limited permissions.
  - Narrow domain adaptation backed by a private evaluation set.

- **Use with strong guardrails**
  - Function calling and workflow automation.
  - Long-document extraction.
  - Repository-level coding.
  - Multilingual professional content.
  - Synthetic data generation.
  - Security analysis.
  - Any task involving private retrieved documents or external side effects.

- **Escalate or avoid**
  - High-stakes factual advice.
  - Unverified current or obscure knowledge.
  - Autonomous long-horizon agents.
  - Exact exhaustive accounting or record keeping.
  - Irreversible actions.
  - Decisions affecting rights, safety, money, or legal status.

## 8. Sources

- **[S1] Google DeepMind — Gemma 3 model card.** Specifications, intended uses, benchmark results, limitations, safety caveats, and August 2024 cutoff. <https://ai.google.dev/gemma/docs/core/model_card_3>
- **[S2] Qwen Team — “Qwen3: Think Deeper, Act Faster” (2025).** Model sizes, context, languages, thinking modes, local runtimes, and agent/tool positioning. <https://qwenlm.github.io/blog/qwen3/>
- **[S3] Mistral AI — “Mistral Small 3” (2025).** 24B local deployment, reported latency, intended uses, and single-machine examples. <https://mistral.ai/news/mistral-small-3/>
- **[S4] Microsoft — Phi-4 model card.** 14B specifications, benchmark table, intended use, factual and multilingual limitations, cutoff, and code caveats. <https://huggingface.co/microsoft/phi-4>
- **[S5] ggml-org — llama.cpp documentation.** Supported backends, quantization formats, CPU/GPU hybrid inference, CLI, and local server support. <https://github.com/ggml-org/llama.cpp>
- **[S6] Bang et al. — “HalluLens: LLM Hallucination Benchmark,” ACL 2025.** Dynamic factuality/hallucination tasks, refusal behavior, and nonexistent-entity results across 7B–27B models. <https://aclanthology.org/2025.acl-long.1176/>
- **[S7] Nyamsuren — “Evaluating Quantized Large Language Models for Code Generation on Low-Resource Language Benchmarks,” 2025.** Consumer CPU deployment and measured 2-/4-/8-bit code-generation trade-offs. <https://doi.org/10.1016/j.array.2025.100403> (open manuscript: <https://arxiv.org/abs/2410.14766>)
- **[S8] Caldas and de Souza — “A Comprehensive Evaluation of Large Language Models for Retrieval-Augmented Generation under Noisy Conditions,” CHOMPS 2025.** RAG cost/performance and noise-robustness comparison. <https://aclanthology.org/2025.chomps-main.6/>
- **[S9] Google Developers Blog — “Gemma 3 QAT Models: Bringing state-of-the-art AI to consumer GPUs” (2025).** Reported Gemma 3 weight-memory reduction from BF16 to INT4. <https://developers.googleblog.com/en/gemma-3-quantized-aware-trained-state-of-the-art-ai-to-consumer-gpus/>
- **[S10] Hsieh et al. — “RULER: What’s the Real Context Size of Your Long-Context Language Models?” COLM 2024.** Measured degradation with context length, distractors, multi-hop tracing, and aggregation. <https://openreview.net/forum?id=kIoBbc76Sy> (paper: <https://arxiv.org/abs/2404.06654>)
- **[S11] Kalai et al. — “Why Language Models Hallucinate” (2025).** Analysis of how pretraining uncertainty and binary benchmark scoring encourage guessing rather than abstention. <https://arxiv.org/abs/2509.04664>
- **[S12] Kaur et al. — “ToolScan: A Benchmark for Characterizing Errors in Tool-Use LLMs,” Building Trust Workshop at ICLR 2025.** Seven tool-use error categories and model-level failure analysis. <https://openreview.net/forum?id=09tnQgqKuZ> (paper: <https://arxiv.org/abs/2411.13547>)
- **[S13] OWASP GenAI Security Project — “LLM01:2025 Prompt Injection” and prevention guidance.** Direct, indirect, multimodal, and RAG injection risks and mitigations. <https://genai.owasp.org/llmrisk/llm01-prompt-injection/> and <https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html>

## 9. Research limitations

- No single benchmark represents every local workflow, and benchmark scores are not directly comparable when prompts and evaluation harnesses differ.
- Several capability and hardware claims come from model vendors; they are clearly presented as vendor reports and should be reproduced locally.
- The hardware examples do not predict throughput on a particular machine.
- Model quality changes quickly, but the structural failure modes—hallucination, weak abstention, long-context degradation, tool-call errors, quantization loss, and unsafe autonomy—remain relevant across model generations.
- This is a research synthesis, not a benchmark run on the reader’s hardware. A deployment decision should end with task-specific evaluation on the exact checkpoint and quantization being considered.
