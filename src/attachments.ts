import { generateText, trimTokens } from "@elizaos/core";
import { parseJSONObjectFromText } from "@elizaos/core";
import {
    type IAgentRuntime,
    type Media,
    ModelClass,
} from "@elizaos/core";
import { type Attachment, Collection } from "discord.js";
import fs from "fs";

async function generateSummary(
    runtime: IAgentRuntime,
    text: string
): Promise<{ title: string; description: string }> {
    // make sure text is under 128k characters
    text = await trimTokens(text, 100000, runtime);

    const prompt = `Please generate a concise summary for the following text:

  Text: """
  ${text}
  """

  Respond with a JSON object in the following format:
  \`\`\`json
  {
    "title": "Generated Title",
    "summary": "Generated summary and/or description of the text"
  }
  \`\`\``;

    const response = await generateText({
        runtime,
        context: prompt,
        modelClass: ModelClass.SMALL,
    });

    const parsedResponse = parseJSONObjectFromText(response);

    if (parsedResponse?.title && parsedResponse?.summary) {
        return {
            title: parsedResponse.title,
            description: parsedResponse.summary,
        };
    }

    return {
        title: "",
        description: "",
    };
}

export class AttachmentManager {
    private attachmentCache: Map<string, Media> = new Map();
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async processAttachments(
        attachments: Collection<string, Attachment> | Attachment[]
    ): Promise<Media[]> {
        const processedAttachments: Media[] = [];
        const attachmentCollection =
            attachments instanceof Collection
                ? attachments
                : new Collection(attachments.map((att) => [att.id, att]));

        for (const [, attachment] of attachmentCollection) {
            const media = await this.processAttachment(attachment);
            if (media) {
                processedAttachments.push(media);
            }
        }

        return processedAttachments;
    }

    async processAttachment(attachment: Attachment): Promise<Media | null> {
        if (this.attachmentCache.has(attachment.url)) {
            return this.attachmentCache.get(attachment.url)!;
        }

        let media: Media | null = null;
        if (attachment.contentType?.startsWith("text/plain")) {
            media = await this.processPlaintextAttachment(attachment);
        }

        if (media) {
            this.attachmentCache.set(attachment.url, media);
        }
        return media;
    }

    private async processPlaintextAttachment(
        attachment: Attachment
    ): Promise<Media> {
        try {
            const response = await fetch(attachment.url);
            const text = await response.text();
            const { title, description } = await generateSummary(
                this.runtime,
                text
            );

            return {
                id: attachment.id,
                url: attachment.url,
                title: title || "Plaintext Attachment",
                source: "Plaintext",
                description: description || "A plaintext document",
                text: text,
            };
        } catch (error) {
            console.error(
                `Error processing plaintext attachment: ${error.message}`
            );
            return {
                id: attachment.id,
                url: attachment.url,
                title: "Plaintext Attachment (retrieval failed)",
                source: "Plaintext",
                description: "A plaintext document that could not be retrieved",
                text: `This is a plaintext attachment. File name: ${attachment.name}, Size: ${attachment.size} bytes`,
            };
        }
    }
}
