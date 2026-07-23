export interface GQLBody {
    data: Record<string, object> | null;
    extensions: GQLBodyExtension;
    errors?: GQLBodyError[];
}

export interface GQLBodyExtension {
    analyzer: {
        complexity: number,
        depth: number;
    };
}

export interface GQLBodyError {
    message: string;
    locations: { line: number, column: number; }[];
    path?: string[];
    extensions?: {
        code: string,
        fields: Record<string, unknown>,
        message: string,
        status: number;
    };
}

export interface GQLFuncResult {
    status: number;
    ok: boolean;
    data: Record<string, {}>;
    errors?: GQLBodyError[];
}
