export interface paths {
    "/v1/asyncapi": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Serve Asyncapi Viewer */
        get: operations["serve_asyncapi_viewer"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/asyncapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Serve Asyncapi */
        get: operations["serve_asyncapi"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fs/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Fs Dir */
        get: operations["list_fs_dir"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fs/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Fs Projects */
        get: operations["list_fs_projects"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fs/roots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Fs Roots */
        get: operations["list_fs_roots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fs/tree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Browse Fs Tree */
        get: operations["browse_fs_tree"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Gateway Info */
        get: operations["gateway_info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Openai List Models */
        get: operations["openai_list_models"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/responses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Openai Responses */
        post: operations["openai_responses"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/v1/chat/completions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Openai Chat */
        post: operations["openai_chat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/v1/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Anthropic Messages */
        post: operations["anthropic_messages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/v1/messages/count_tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Anthropic Count Tokens */
        post: operations["anthropic_count_tokens"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/v1/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Anthropic List Models */
        get: operations["anthropic_list_models"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/v1/responses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Openai Responses V1 */
        post: operations["openai_responses_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/v1beta/models/{model_name}:generateContent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Gemini Generate */
        post: operations["gemini_generate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/llm/{route_id}/v1beta/models/{model_name}:streamGenerateContent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Gemini Stream */
        post: operations["gemini_stream"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/model-metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Gateway Model Metadata */
        get: operations["gateway_model_metadata"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/routes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Routes */
        get: operations["list_routes"];
        put?: never;
        /** Create Route */
        post: operations["create_route"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/routes/{route_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Route */
        delete: operations["delete_route"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/gateway/routes/{route_id}/model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Set Route Model */
        patch: operations["set_route_model"];
        trace?: never;
    };
    "/v1/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Providers */
        get: operations["list_providers"];
        put?: never;
        /** Create Provider */
        post: operations["create_provider"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/providers/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Provider */
        delete: operations["delete_provider"];
        options?: never;
        head?: never;
        /** Update Provider */
        patch: operations["update_provider"];
        trace?: never;
    };
    "/v1/providers/{name}/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Provider Models */
        get: operations["list_provider_models"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/providers/{name}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify Provider */
        post: operations["verify_provider"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/runtime/operations/{operation_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel Runtime Start */
        post: operations["cancel_runtime_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/runtime/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start Runtime Session */
        post: operations["start_runtime_session"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/runtime/sessions/{session_id}/effort": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Set Session Effort */
        patch: operations["set_session_effort"];
        trace?: never;
    };
    "/v1/runtime/sessions/{session_id}/execution": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Execution Status */
        get: operations["execution_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/runtimes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Runtimes */
        get: operations["list_runtimes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/runtimes/{harness}/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Native Models */
        get: operations["list_native_models"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Sessions */
        get: operations["list_sessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Session */
        get: operations["get_session"];
        put?: never;
        post?: never;
        /** Delete Session */
        delete: operations["delete_session"];
        options?: never;
        head?: never;
        /** Rename Session */
        patch: operations["rename_session"];
        trace?: never;
    };
    "/v1/sessions/{session_id}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload Attachment */
        post: operations["upload_attachment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Session Availability */
        get: operations["session_availability"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download Session File */
        get: operations["download_session_file"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/fork": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Fork Runtime Session */
        post: operations["fork_runtime_session"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Session History */
        get: operations["get_session_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/history/record": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download Transcript Record */
        get: operations["download_transcript_record"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Set Session Model */
        patch: operations["set_session_model"];
        trace?: never;
    };
    "/v1/sessions/{session_id}/privacy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Session Privacy */
        get: operations["get_session_privacy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Release Session */
        post: operations["release_session"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/restore-native-model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore Native Model */
        post: operations["restore_native_model"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume Session */
        post: operations["resume_session"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop Session */
        post: operations["stop_session"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/worktree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename Session Worktree */
        patch: operations["rename_session_worktree"];
        trace?: never;
    };
    "/v1/sessions/{session_id}/worktree/finish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Finish Worktree */
        post: operations["finish_worktree"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/worktree/integration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Preview Worktree Integration */
        get: operations["preview_worktree_integration"];
        put?: never;
        /** Integrate Worktree */
        post: operations["integrate_worktree"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/worktree/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve Worktree Conflicts */
        post: operations["resolve_worktree_conflicts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Accounts */
        get: operations["usage_accounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Capabilities */
        get: operations["usage_capabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Overview */
        get: operations["usage_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage/prices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add Price */
        post: operations["add_usage_price"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh */
        post: operations["refresh_usage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage/sessions/{session_id}/erase": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Erase */
        post: operations["erase_session_usage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AttachmentOut */
        AttachmentOut: {
            /** Id */
            id: string;
            /** Media Type */
            media_type: string;
            /** Name */
            name: string;
            /** Reference */
            reference: string;
            /** Size */
            size: number;
        };
        /** ErrorBody */
        ErrorBody: {
            /** Code */
            code: string;
            /** Detail */
            detail?: {
                [key: string]: unknown;
            };
            /** Message */
            message: string;
        };
        /** ErrorEnvelope */
        ErrorEnvelope: {
            error: components["schemas"]["ErrorBody"];
        };
        /**
         * ExecutionBackend
         * @enum {string}
         */
        ExecutionBackend: "host" | "docker";
        /**
         * ExecutionPhase
         * @enum {string}
         */
        ExecutionPhase: "checking" | "preparing_image" | "preparing_state" | "starting" | "ready" | "blocked" | "failed" | "stopping" | "stopped";
        /** ExecutionStatusOut */
        ExecutionStatusOut: {
            /** Container Id */
            container_id?: string | null;
            /** Effective Binding */
            effective_binding: boolean;
            execution_backend: components["schemas"]["ExecutionBackend"];
            /** Generation */
            generation: number;
            phase: components["schemas"]["ExecutionPhase"];
            /** Policy Revision */
            policy_revision: number;
            privacy_mode: components["schemas"]["PrivacyMode"];
            /** Reason */
            reason?: string | null;
            /** Revision */
            revision: number;
            /** Session Id */
            session_id: string;
        };
        /** FsEntryOut */
        FsEntryOut: {
            /** Is Dir */
            is_dir: boolean;
            /** Modified At */
            modified_at: number | null;
            /** Name */
            name: string;
            /** Path */
            path: string;
            /** Size */
            size: number | null;
        };
        /** FsNodeOut */
        FsNodeOut: {
            /** Children */
            children: components["schemas"]["FsNodeOut"][];
            entry: components["schemas"]["FsEntryOut"];
        };
        /** GatewayInfoOut */
        GatewayInfoOut: {
            /** Providers */
            providers: components["schemas"]["ProvidersInfoOut"][];
            /** Routes */
            routes: components["schemas"]["RouteOut"][];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HistoryPageOut */
        HistoryPageOut: {
            /** Entries */
            entries: string[];
            /** Has More */
            has_more: boolean;
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** IntegrateIn */
        IntegrateIn: {
            /** Message */
            message: string;
            /**
             * Strategy
             * @default squash
             * @enum {string}
             */
            strategy?: "squash" | "merge";
            /** Target */
            target: string;
            /** Token */
            token: string;
        };
        /** IntegrationPreview */
        IntegrationPreview: {
            /** Branches */
            branches: string[];
            /** Conflicts */
            conflicts?: string[];
            /** Default Branch */
            default_branch: string | null;
            /**
             * Diff
             * @default
             */
            diff?: string;
            /** Files */
            files?: string[];
            /**
             * Result Tree
             * @default
             */
            result_tree?: string;
            /**
             * Source Head
             * @default
             */
            source_head?: string;
            /**
             * Source Tree
             * @default
             */
            source_tree?: string;
            /**
             * Strategy
             * @default squash
             * @enum {string}
             */
            strategy?: "squash" | "merge";
            /** Target */
            target?: string | null;
            /**
             * Target Dirty
             * @default false
             */
            target_dirty?: boolean;
            /**
             * Target Head
             * @default
             */
            target_head?: string;
            /** Token */
            token?: string | null;
        };
        /** InteractionModeOut */
        InteractionModeOut: {
            /** Applied */
            applied: string;
            /** Mode */
            mode: string;
        };
        /** ModelOut */
        ModelOut: {
            /** Default Effort */
            default_effort: string | null;
            /** Display Name */
            display_name?: string | null;
            /** Id */
            id: string;
            /** Image Input */
            image_input?: boolean | null;
            /** Input Modalities */
            input_modalities?: string[] | null;
            /** Reasoning Efforts */
            reasoning_efforts: string[];
            /** Reasoning Supported */
            reasoning_supported?: boolean | null;
            /** Tool Call */
            tool_call?: boolean | null;
        };
        /**
         * ModelSource
         * @enum {string}
         */
        ModelSource: "gateway" | "native";
        /** NativeModel */
        NativeModel: {
            /** Default Effort */
            default_effort?: string | null;
            /** Display Name */
            display_name: string;
            /** Id */
            id: string;
            /**
             * Reasoning Efforts
             * @default []
             */
            reasoning_efforts?: string[];
        };
        /** PrivacyEntryOut */
        PrivacyEntryOut: {
            /** Kind */
            kind: string;
            /** Redacted */
            redacted: string;
        };
        /**
         * PrivacyMode
         * @enum {string}
         */
        PrivacyMode: "none" | "surrogate";
        /** ProviderIn */
        ProviderIn: {
            /** Api Base */
            api_base?: string | null;
            /** Api Key */
            api_key: string;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /**
             * Verify
             * @default true
             */
            verify?: boolean;
        };
        /** ProviderOut */
        ProviderOut: {
            /** Api Base */
            api_base: string | null;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /** State */
            state: string;
        };
        /** ProviderUpdateIn */
        ProviderUpdateIn: {
            /** Api Base */
            api_base?: string | null;
            /** Api Key */
            api_key?: string | null;
        };
        /** ProvidersInfoOut */
        ProvidersInfoOut: {
            /** Api Base */
            api_base: string | null;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /** State */
            state: string;
        };
        /** ReleaseSessionIn */
        ReleaseSessionIn: {
            /**
             * Confirmed
             * @default false
             */
            confirmed?: boolean;
        };
        /** RenameIn */
        RenameIn: {
            /** Title */
            title: string;
        };
        /** RenameWorktreeIn */
        RenameWorktreeIn: {
            /** Id */
            id: string;
        };
        /** ReviewIn */
        ReviewIn: {
            /**
             * Strategy
             * @default squash
             * @enum {string}
             */
            strategy?: "squash" | "merge";
            /** Target */
            target: string;
            /** Token */
            token: string;
        };
        /** RouteCreateIn */
        RouteCreateIn: {
            /** Effort */
            effort?: string | null;
            /** Formats */
            formats: string[];
            /** Model */
            model: string;
        };
        /** RouteCreatedOut */
        RouteCreatedOut: {
            /** Child Token */
            child_token: string;
            /** Created At */
            created_at: number;
            /** Formats */
            formats: string[];
            /** Id */
            id: string;
            /** Model Ref */
            model_ref: string;
            /** Provider */
            provider: string;
        };
        /** RouteModelIn */
        RouteModelIn: {
            /** Model */
            model: string;
        };
        /** RouteOut */
        RouteOut: {
            /** Created At */
            created_at: number;
            /** Formats */
            formats: string[];
            /** Id */
            id: string;
            /** Model Ref */
            model_ref: string;
            /** Provider */
            provider: string;
        };
        /** RuntimeOut */
        RuntimeOut: {
            /** Capabilities */
            capabilities?: {
                [key: string]: unknown;
            } | null;
            /** Degraded */
            degraded: boolean;
            /** Harness */
            harness: string;
            /** Installed */
            installed: boolean;
            /** Version */
            version?: string | null;
        };
        /** RuntimeResumeIn */
        RuntimeResumeIn: {
            /** Mode */
            mode?: string | null;
        };
        /** RuntimeSessionOut */
        RuntimeSessionOut: {
            /** @default host */
            execution_backend?: components["schemas"]["ExecutionBackend"];
            /** Gateway Route Id */
            gateway_route_id: string | null;
            /** Harness */
            harness: string;
            /** Id */
            id: string;
            /** Mode */
            mode?: string | null;
            /**
             * Policy Revision
             * @default 1
             */
            policy_revision?: number;
            /** @default none */
            privacy_mode?: components["schemas"]["PrivacyMode"];
            /** Project Path */
            project_path?: string | null;
            /** State */
            state: string;
            worktree?: components["schemas"]["Worktree"] | null;
        };
        /** RuntimeStartIn */
        RuntimeStartIn: {
            /** Cwd */
            cwd: string;
            /** Effort */
            effort?: string | null;
            /** @default host */
            execution_backend?: components["schemas"]["ExecutionBackend"];
            /** Harness */
            harness: string;
            /** Mode */
            mode?: string | null;
            /** Model */
            model: string;
            model_source?: components["schemas"]["ModelSource"] | null;
            /** Operation Id */
            operation_id?: string | null;
            /** @default none */
            privacy_mode?: components["schemas"]["PrivacyMode"];
            /**
             * Worktree
             * @default false
             */
            worktree?: boolean;
            /** Worktree Id */
            worktree_id?: string | null;
        };
        /**
         * SessionActivityState
         * @enum {string}
         */
        SessionActivityState: "idle" | "busy" | "unknown";
        /** SessionAvailability */
        SessionAvailability: {
            activity: components["schemas"]["SessionActivityState"];
            /**
             * Can Release
             * @default false
             */
            can_release?: boolean;
            /**
             * Can Restore
             * @default false
             */
            can_restore?: boolean;
            /**
             * Can Resume
             * @default false
             */
            can_resume?: boolean;
            owner: components["schemas"]["SessionOwner"];
            /** Reason */
            reason?: string | null;
        };
        /** SessionEffortIn */
        SessionEffortIn: {
            /** Effort */
            effort?: string | null;
        };
        /** SessionForkIn */
        SessionForkIn: {
            execution_backend: components["schemas"]["ExecutionBackend"];
            /** Mode */
            mode?: string | null;
            /** Operation Id */
            operation_id?: string | null;
            privacy_mode: components["schemas"]["PrivacyMode"];
            /**
             * Worktree
             * @default false
             */
            worktree?: boolean;
            /** Worktree Id */
            worktree_id?: string | null;
        };
        /** SessionOut */
        SessionOut: {
            /** Activity */
            activity?: string | null;
            /** Created At */
            created_at: number;
            /** @default host */
            execution_backend?: components["schemas"]["ExecutionBackend"];
            /** Harness */
            harness: string;
            /** Id */
            id: string;
            interaction_mode?: components["schemas"]["InteractionModeOut"] | null;
            /** Last Activity At */
            last_activity_at?: number | null;
            /** Model */
            model: string | null;
            model_source?: components["schemas"]["ModelSource"] | null;
            /** Native Id */
            native_id: string | null;
            /**
             * Policy Revision
             * @default 1
             */
            policy_revision?: number;
            /** @default none */
            privacy_mode?: components["schemas"]["PrivacyMode"];
            /** Project Path */
            project_path: string;
            /** Reasoning Effort */
            reasoning_effort?: string | null;
            /** State */
            state: string;
            /** Title */
            title: string;
            /** Updated At */
            updated_at: number;
            worktree?: components["schemas"]["Worktree"] | null;
        };
        /**
         * SessionOwner
         * @enum {string}
         */
        SessionOwner: "mandri" | "external" | "unowned" | "unknown";
        /** SessionPrivacyOut */
        SessionPrivacyOut: {
            /** Entries */
            entries: components["schemas"]["PrivacyEntryOut"][];
            /** Revision */
            revision: number;
        };
        /** UsageAccountOut */
        UsageAccountOut: {
            /** Account Id */
            account_id: string;
            /** Auth Mode */
            auth_mode?: string | null;
            /** Credits */
            credits?: string | null;
            /** Harness */
            harness: string;
            /** Monthly Fee Usd */
            monthly_fee_usd?: string | null;
            /** Observed At */
            observed_at: number;
            /** Plan */
            plan?: string | null;
            /** Status */
            status: string;
            /**
             * Verified
             * @default false
             */
            verified?: boolean;
            /** Windows */
            windows?: {
                [key: string]: string | number | boolean | null;
            }[];
        };
        /** UsageAccountsOut */
        UsageAccountsOut: {
            /** Accounts */
            accounts: components["schemas"]["UsageAccountOut"][];
            /** As Of */
            as_of: number;
            /** Revision */
            revision: number;
        };
        /** UsageBucketOut */
        UsageBucketOut: {
            /** Cache Read Tokens */
            cache_read_tokens: number | null;
            /** Cache Write Tokens */
            cache_write_tokens: number | null;
            /** Date */
            date: string;
            /** Fact Count */
            fact_count: number;
            /** Incomplete Fact Count */
            incomplete_fact_count: number;
            /** Input Tokens */
            input_tokens: number | null;
            /** Missing Fields */
            missing_fields: {
                [key: string]: number;
            };
            /** Output Tokens */
            output_tokens: number | null;
            /** Reasoning Tokens */
            reasoning_tokens: number | null;
            /** Reported Cost Usd */
            reported_cost_usd: string | null;
            /** Request Count */
            request_count: number | null;
            /** Total Tokens */
            total_tokens: number | null;
            /**
             * Unclassified Fact Count
             * @default 0
             */
            unclassified_fact_count?: number;
            /** Unpriced Fact Count */
            unpriced_fact_count: number;
            /** Unpriced Reasons */
            unpriced_reasons?: {
                [key: string]: number;
            };
            /** Usd Equivalent */
            usd_equivalent: string | null;
            /** Valuation Bases */
            valuation_bases?: {
                [key: string]: number;
            };
        };
        /** UsageCapabilitiesOut */
        UsageCapabilitiesOut: {
            /** As Of */
            as_of: number;
            /** Capabilities */
            capabilities: components["schemas"]["UsageCapabilityOut"][];
        };
        /** UsageCapabilityOut */
        UsageCapabilityOut: {
            /** Detail */
            detail: string;
            /** Harness */
            harness: string;
            /** History */
            history: string;
            /** Live */
            live: string;
            /** Quotas */
            quotas: string;
        };
        /** UsageEraseIn */
        UsageEraseIn: {
            /**
             * Confirmed
             * @default false
             */
            confirmed?: boolean;
        };
        /** UsageEraseOut */
        UsageEraseOut: {
            /** Revision */
            revision: number;
        };
        /** UsageGroupOut */
        UsageGroupOut: {
            /** Cache Read Tokens */
            cache_read_tokens: number | null;
            /** Cache Write Tokens */
            cache_write_tokens: number | null;
            /**
             * Deleted
             * @default false
             */
            deleted?: boolean;
            /** Fact Count */
            fact_count: number;
            /** Incomplete Fact Count */
            incomplete_fact_count: number;
            /** Input Tokens */
            input_tokens: number | null;
            /** Key */
            key: string | null;
            /** Missing Fields */
            missing_fields: {
                [key: string]: number;
            };
            /** Output Tokens */
            output_tokens: number | null;
            /** Reasoning Tokens */
            reasoning_tokens: number | null;
            /** Reported Cost Usd */
            reported_cost_usd: string | null;
            /** Request Count */
            request_count: number | null;
            /** Total Tokens */
            total_tokens: number | null;
            /**
             * Unclassified Fact Count
             * @default 0
             */
            unclassified_fact_count?: number;
            /** Unpriced Fact Count */
            unpriced_fact_count: number;
            /** Unpriced Reasons */
            unpriced_reasons?: {
                [key: string]: number;
            };
            /** Usd Equivalent */
            usd_equivalent: string | null;
            /** Valuation Bases */
            valuation_bases?: {
                [key: string]: number;
            };
        };
        /** UsageMetricsOut */
        UsageMetricsOut: {
            /** Cache Read Tokens */
            cache_read_tokens: number | null;
            /** Cache Write Tokens */
            cache_write_tokens: number | null;
            /** Fact Count */
            fact_count: number;
            /** Incomplete Fact Count */
            incomplete_fact_count: number;
            /** Input Tokens */
            input_tokens: number | null;
            /** Missing Fields */
            missing_fields: {
                [key: string]: number;
            };
            /** Output Tokens */
            output_tokens: number | null;
            /** Reasoning Tokens */
            reasoning_tokens: number | null;
            /** Reported Cost Usd */
            reported_cost_usd: string | null;
            /** Request Count */
            request_count: number | null;
            /** Total Tokens */
            total_tokens: number | null;
            /**
             * Unclassified Fact Count
             * @default 0
             */
            unclassified_fact_count?: number;
            /** Unpriced Fact Count */
            unpriced_fact_count: number;
            /** Unpriced Reasons */
            unpriced_reasons?: {
                [key: string]: number;
            };
            /** Usd Equivalent */
            usd_equivalent: string | null;
            /** Valuation Bases */
            valuation_bases?: {
                [key: string]: number;
            };
        };
        /** UsageOverviewOut */
        UsageOverviewOut: {
            /** As Of */
            as_of: number;
            /** Breakdown */
            breakdown: components["schemas"]["UsageGroupOut"][];
            /** Breakdown Total */
            breakdown_total: number;
            /** Catalog */
            catalog?: {
                [key: string]: {
                    [key: string]: unknown;
                };
            };
            /** History Status */
            history_status?: {
                [key: string]: number;
            };
            /** Last Observed At */
            last_observed_at?: number | null;
            /** Revision */
            revision: number;
            /** Source Breakdown */
            source_breakdown?: {
                [key: string]: components["schemas"]["UsageMetricsOut"];
            };
            summary: components["schemas"]["UsageMetricsOut"];
            sync_state?: components["schemas"]["UsageSyncStateOut"];
            /** Timeseries */
            timeseries: components["schemas"]["UsageBucketOut"][];
            /** Timezone */
            timezone: string;
            unallocated: components["schemas"]["UsageMetricsOut"];
            undated: components["schemas"]["UsageMetricsOut"];
        };
        /** UsagePriceIn */
        UsagePriceIn: {
            /** Effective From */
            effective_from: number;
            /** Effective To */
            effective_to?: number | null;
            /** Model */
            model: string;
            /** Price Id */
            price_id: string;
            /** Provider */
            provider: string;
            /** Rates */
            rates: {
                [key: string]: string;
            };
        };
        /** UsagePriceOut */
        UsagePriceOut: {
            /** Revision */
            revision: number;
        };
        /** UsageRefreshOut */
        UsageRefreshOut: {
            /** Retry After Ms */
            retry_after_ms: number;
            /**
             * Status
             * @enum {string}
             */
            status: "queued" | "completed" | "unavailable";
        };
        /** UsageSyncStateOut */
        UsageSyncStateOut: {
            /** Discard Reasons */
            discard_reasons?: {
                [key: string]: number;
            };
            /**
             * Discarded Event Count
             * @default 0
             */
            discarded_event_count?: number;
            /**
             * Gap Count
             * @default 0
             */
            gap_count?: number;
            /**
             * Scope
             * @default daemon
             */
            scope?: string;
            /**
             * Source Count
             * @default 0
             */
            source_count?: number;
            /**
             * Status
             * @default unavailable
             */
            status?: string;
            /** Status Counts */
            status_counts?: {
                [key: string]: number;
            };
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /** Worktree */
        Worktree: {
            /** Base Commit */
            base_commit: string;
            /** Base Ref */
            base_ref: string;
            /**
             * Discard
             * @default false
             */
            discard?: boolean;
            /** Id */
            id: string;
            /** Integrated Commit */
            integrated_commit?: string | null;
            /** Integrated Head */
            integrated_head?: string | null;
            /** Integrated Index */
            integrated_index?: string | null;
            /** Integrated Target */
            integrated_target?: string | null;
            /** Integrated Tree */
            integrated_tree?: string | null;
            /** Path */
            path: string;
            /** Pending Id */
            pending_id?: string | null;
            /** Pending Integration */
            pending_integration?: {
                [key: string]: string;
            } | null;
            /**
             * Relative Path
             * @default .
             */
            relative_path?: string;
            /** Repository */
            repository: string;
            /** Source Path */
            source_path: string;
            /**
             * State
             * @default preparing
             */
            state?: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    serve_asyncapi_viewer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    serve_asyncapi: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    list_fs_dir: {
        parameters: {
            query: {
                path: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FsEntryOut"][];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Filesystem or internal read failure */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    list_fs_projects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string[];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Filesystem or internal read failure */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    list_fs_roots: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FsEntryOut"][];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Filesystem or internal read failure */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    browse_fs_tree: {
        parameters: {
            query: {
                path: string;
                depth?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FsNodeOut"];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Filesystem or internal read failure */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    gateway_info: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GatewayInfoOut"];
                };
            };
        };
    };
    openai_list_models: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    openai_responses: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    openai_chat: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    anthropic_messages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    anthropic_count_tokens: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    anthropic_list_models: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    openai_responses_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    gemini_generate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
                model_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    gemini_stream: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
                model_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    gateway_model_metadata: {
        parameters: {
            query: {
                model: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_routes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteOut"][];
                };
            };
        };
    };
    create_route: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RouteCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteCreatedOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_route: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_route_model: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                route_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RouteModelIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_providers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"][];
                };
            };
        };
    };
    create_provider: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProviderIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_provider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_provider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProviderUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_provider_models: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelOut"][];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_provider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_runtime_start: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_runtime_session: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RuntimeStartIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RuntimeSessionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_session_effort: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionEffortIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    execution_status: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionStatusOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_runtimes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RuntimeOut"][];
                };
            };
        };
    };
    list_native_models: {
        parameters: {
            query?: {
                cwd?: string | null;
            };
            header?: never;
            path: {
                harness: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NativeModel"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_sessions: {
        parameters: {
            query?: {
                harness?: string | null;
                state?: string | null;
                project_path?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_session: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_session: {
        parameters: {
            query?: {
                purge?: boolean;
                discard_worktree?: boolean;
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rename_session: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_attachment: {
        parameters: {
            query: {
                name: string;
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    session_availability: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionAvailability"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_session_file: {
        parameters: {
            query: {
                path: string;
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    fork_runtime_session: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionForkIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RuntimeSessionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_session_history: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HistoryPageOut"];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Harness transcript store unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    download_transcript_record: {
        parameters: {
            query: {
                reference: string;
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Harness transcript store unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    set_session_model: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_session_privacy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionPrivacyOut"];
                };
            };
            /** @description Malformed request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Harness transcript store unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    release_session: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReleaseSessionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionAvailability"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    restore_native_model: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionAvailability"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resume_session: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RuntimeResumeIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RuntimeSessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    stop_session: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rename_session_worktree: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameWorktreeIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    finish_worktree: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    preview_worktree_integration: {
        parameters: {
            query?: {
                target?: string | null;
                strategy?: "squash" | "merge";
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationPreview"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    integrate_worktree: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntegrateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resolve_worktree_conflicts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflicting state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    usage_accounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsageAccountsOut"];
                };
            };
        };
    };
    usage_capabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsageCapabilitiesOut"];
                };
            };
        };
    };
    usage_overview: {
        parameters: {
            query?: {
                session_id?: string | null;
                root_session_id?: string | null;
                project_path?: string | null;
                harness?: string | null;
                provider?: string | null;
                model?: string | null;
                billing_mode?: string | null;
                from_ms?: number | null;
                to_ms?: number | null;
                timezone?: string;
                include_deleted?: boolean;
                include_descendants?: boolean;
                group_by?: "session" | "project" | "model" | "harness" | "billing_mode";
                limit?: number;
                offset?: number;
                expected_revision?: number | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsageOverviewOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_usage_price: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UsagePriceIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsagePriceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_usage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsageRefreshOut"];
                };
            };
        };
    };
    erase_session_usage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UsageEraseIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsageEraseOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
