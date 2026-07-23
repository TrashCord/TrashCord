export interface Attachment {
    filename: string;
    url: string;
}

export interface Message {
    id: string;
    author: {
        id: string;
        username: string;
        discriminator: string;
    };
    content: string;
    timestamp: string;
    edited_timestamp: string | null;
    attachments: Attachment[];
}