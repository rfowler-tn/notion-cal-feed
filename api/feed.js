import { Client } from '@notionhq/client';
import { createEvents } from 'ics';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// Helper to extract exact times from Notion's date format
function parseDate(dateStr) {
  if (!dateStr) return null;
  const dateObj = new Date(dateStr);
  
  if (dateStr.includes('T')) {
    return [
      dateObj.getFullYear(),
      dateObj.getMonth() + 1,
      dateObj.getDate(),
      dateObj.getHours(),
      dateObj.getMinutes()
    ];
  }
  return [
    parseInt(dateStr.substring(0, 4)),
    parseInt(dateStr.substring(5, 7)),
    parseInt(dateStr.substring(8, 10))
  ];
}

// Helper to safely grab standard text properties
function getPropValue(prop) {
  if (!prop) return '';
  if (prop.select) return prop.select.name;
  if (prop.rich_text && prop.rich_text.length > 0) return prop.rich_text[0].plain_text;
  return '';
}

export default async function handler(req, res) {
  try {
    let allPages = [];
    let cursor = undefined;
    let hasMore = true;

    // 1. Pagination: Fetch all rows from the database
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        filter: {
          property: 'Date',
          date: { is_not_empty: true },
        },
      });

      allPages.push(...response.results);
      cursor = response.next_cursor;
      hasMore = response.has_more;
    }

    const events = [];
    const instructorCache = new Map(); // Our dictionary to remember instructor names

    // 2. Build the events sequentially to handle relational lookups safely
    for (const page of allPages) {
      const title = page.properties.Name?.title[0]?.plain_text || 'Untitled Event';
      const dateData = page.properties.Date?.date;
      
      const start = parseDate(dateData?.start);
      const end = parseDate(dateData?.end);

      const location = getPropValue(page.properties.Location);
      const sessionType = getPropValue(page.properties['Session Type']);
      const notes = getPropValue(page.properties.Notes);

      // --- NEW: Relational Instructor Lookup ---
      let instructorName = '';
      const instProp = page.properties.Instructor;

      if (instProp?.relation && instProp.relation.length > 0) {
        const relatedId = instProp.relation[0].id;
        
        // Check if we already know this instructor's name
        if (instructorCache.has(relatedId)) {
          instructorName = instructorCache.get(relatedId);
        } else {
          // If not, ask Notion for the related page details
          try {
            const relatedPage = await notion.pages.retrieve({ page_id: relatedId });
            // Dig out the primary title of the related page
            const titleProp = Object.values(relatedPage.properties).find(p => p.type === 'title');
            instructorName = titleProp?.title[0]?.plain_text || 'Unknown Instructor';
            
            // Save it in the dictionary for next time
            instructorCache.set(relatedId, instructorName);
          } catch (e) {
            console.error('Failed to fetch instructor:', e);
            instructorName = 'Unknown Instructor';
          }
        }
      } else {
        // Fallback just in case the field is ever changed back to standard text
        instructorName = getPropValue(instProp);
      }
      // -----------------------------------------

      // 3. Format the description (Course field removed!)
      let description = `Instructor: ${instructorName}\nType: ${sessionType}`;
      if (notes) {
        description += `\n\nNotes: ${notes}`;
      }
      description += `\n\nNotion Link: ${page.url}`;

      const event = {
        title: title,
        start: start,
        location: location,
        description: description,
        url: page.url,
      };

      if (end) {
        event.end = end;
      }

      events.push(event);
    }

    // 4. Generate the ICS file
    const { error, value } = createEvents(events);
    if (error) throw error;

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="notion-feed.ics"');
    res.status(200).send(value);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to generate calendar feed' });
  }
}
